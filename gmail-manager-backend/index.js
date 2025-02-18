const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Initialize OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);

app.get('/auth/check', (req, res) => {
    const credentials = oauth2Client.credentials;
    if (credentials && credentials.access_token) {
        res.json({ isAuthenticated: true });
    } else {
        res.json({ isAuthenticated: false });
    }
});

// Store tokens in a local file
const TOKEN_STORAGE = path.join(__dirname, 'tokens.json');

function saveUserToken(userId, tokens) {
    let allTokens = {};
    if (fs.existsSync(TOKEN_STORAGE)) {
        allTokens = JSON.parse(fs.readFileSync(TOKEN_STORAGE, 'utf8'));
    }
    allTokens[userId] = tokens;
    fs.writeFileSync(TOKEN_STORAGE, JSON.stringify(allTokens));
}

function loadUserToken(userId) {
    if (fs.existsSync(TOKEN_STORAGE)) {
        const allTokens = JSON.parse(fs.readFileSync(TOKEN_STORAGE, 'utf8'));
        return allTokens[userId] || null;
    }
    return null;
}

// Generate OAuth login URL for any user
app.get('/auth/google', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://mail.google.com/',
        'https://www.googleapis.com/auth/userinfo.email',
        // or add more if you need them
      ],
    });
    res.json({ url: authUrl });
});

app.get('/auth/user', async (req, res) => {
    // Check if there's a valid access token in oauth2Client
    if (!oauth2Client.credentials || !oauth2Client.credentials.access_token) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    try {
        const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
        const userInfo = await oauth2.userinfo.get();
        // userInfo.data.email is the user's email
        return res.json({ email: userInfo.data.email });
    } catch (error) {
        console.error("Error retrieving user info:", error);
        return res.status(500).json({ error: 'Failed to retrieve user info' });
    }
});

// Handle OAuth callback after user logs in
app.get('/auth/google/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.redirect("http://localhost:3000?error=missing_auth_code");
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get user’s email
        const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
        const userInfo = await oauth2.userinfo.get();
        const userEmail = userInfo.data.email;

        saveUserToken(userEmail, tokens);
        console.log(`✅ User authenticated: ${userEmail}`);

        // Redirect back with success flag
        res.redirect("http://localhost:3000?auth=success");
    } catch (error) {
        console.error("❌ OAuth authentication failed:", error);
        res.redirect("http://localhost:3000?error=auth_failed");
    }
});

// Load tokens on server startup
const savedTokens = loadUserToken();
if (savedTokens) {
    oauth2Client.setCredentials(savedTokens);
} else {
    console.log("⚠️ No saved tokens found. User needs to log in.");
}

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

let lastDeletionTime = 0; // Store last deletion timestamp
const maxDeletesPerHour = 150; // Adjust based on observed quota behavior
const BATCH_SIZE = 20; // Number of emails to delete per batch
let totalDeletedEmails = 0; // Keep count persistent across deletions
let deletionInProgress = false; // Track ongoing deletion operation

// Function to delete emails in batches with delay
async function deleteEmails(messages) {
    console.log(`Starting deletion process for ${messages.length} emails...`);
    
    let deletedEmails = [];
    for (let i = 0; i < messages.length; i+= BATCH_SIZE) {
        if (deletionInProgress === false) {
            console.log("❌ Deletion stopped by user.");
            return { message: "Deletion stopped by user.", deletedEmails };
        }

        // Get a batch of emails to delete
        const batch = messages.slice(i, i + BATCH_SIZE);
        const batchIds = batch.map(email => email.id);

        try {
            // Delete emails in batch
            await Promise.all(batch.map(email => gmail.users.messages.delete({
                userId: 'me',
                id: email.id
            })));

            deletedEmails.push(...batchIds);
            totalDeletedEmails += batch.length; // Accumulate deleted count
            console.log(`✅ Deleted ${batch.length} emails (Total: ${deletedEmails.length})`);

            // Emit the deleted email count to the frontend
            io.emit("emailDeletedBatch", { count: batch.length, total: totalDeletedEmails });

            // Delay between requests to avoid rate limits (500ms per request)
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            if (error.code ==='ENOTFOUND') {
                console.error("🌐 No internet connection. Stopping deletion process.");
                deletionInProgress = false;
                return { message: "Error: No internet connection. Deletion stopped.", deleteEmails };
            } else if (error.response && error.response.status === 429) {
                console.warn("Rate limit exceed. Pausing for 1 Minute...");
                await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute
                return { message: "Rate limit exceeded. Pausing and will retry...", deletedEmails };
            } else {
                console.error(`❌ Error deleting email ID: ${messages[i].id}`, error);
            }
        }
    }
    
    console.log(`✅ Finished deletion process: ${deletedEmails.length} emails deleted.`);
    return { message: `${deletedEmails.length} emails deleted successfully`, deletedEmails };
}

// Function to continuously delete category emails
async function continuousDelete(category) {
    while (deletionInProgress) {
        try {
            console.log(`🔄 Fetching more ${category} emails...`);
            const listResponse = await gmail.users.messages.list({ userId: 'me', q: `category:${category}` });

            if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
                console.log(`📭 No more ${category} emails found.`);
                deletionInProgress = false;
                return;
            }

            console.log(`📋 Found ${listResponse.data.messages.length} ${category} emails. Deleting...`);
            await deleteEmails(listResponse.data.messages);

            if (!deletionInProgress) {
                console.log("Stopping continuous deletion due to error.");
                return;
            }
        } catch (error) {
            if (error.code === 'ENOTFOUND') {
                console.error("No internet connection detected. Stopping process.");
                deletionInProgress = false;
            } else {
                console.error(`❌ Error fetching ${category} emails:`, error);
                deletionInProgress = false;
            }
        }
    }
}

// Reset deleted count every hour
setInterval(() => {
    console.log("🔄 Resetting deleted emails count.");
    deletedEmailsCount = 0;
}, 3600000); // 1 hour

// Route to delete emails with logging
app.post('/delete-emails', async (req, res) => {
    console.log(`🔍 Received deletion request. Query: "${req.body.query || 'subject:unsubscribe'}"`);

    const currentTime = Date.now();
    if (currentTime - lastDeletionTime < 3600000 && deletedEmailsCount >= maxDeletesPerHour) {
        const nextAvailableTime = new Date(lastDeletionTime + 3600000).toLocaleTimeString();
        console.log(`⏳ Rate limit exceeded. Next batch at ${nextAvailableTime}.`);
        return res.json({ message: `Rate limit exceeded. Next batch at ${nextAvailableTime}.` });
    }

    try {
        const query = req.body.query || 'subject:unsubscribe';
        const listResponse = await gmail.users.messages.list({ userId: 'me', q: query });

        if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
            console.log(`📭 No emails found matching query: "${query}".`);
            return res.json({ message: 'No emails found matching the query.' });
        }

        console.log(`📋 Found ${listResponse.data.messages.length} emails matching query. Proceeding with deletion...`);
        const deletionResult = await deleteEmails(listResponse.data.messages);

        lastDeletionTime = Date.now();
        res.json(deletionResult);
    } catch (error) {
        console.error('❌ Error during email deletion process:', error);
        res.status(500).json({ error: 'Error deleting emails' });
    }
});

// Route to delete only "Promotions" emails
app.post('/delete-promotions', async (req, res) => {
    console.log(`🔍 Received request to delete Promotions emails`);

    if (deletionInProgress) {
        return res.json({ message: "Deletion is already in progress. Please wait or stop the operation." });
    }

    deletionInProgress = true;
    continuousDelete("promotions");
    res.json({ message: "Started continuous deletion of Promotions emails." });
});

// Route to delete only "Updates" emails
app.post('/delete-updates', async (req, res) => {
    console.log(`Received request to delete Updates emails`);

    if (deletionInProgress) {
        return res.json({ message: "Deletion is already in progress. Please wait or stop the operation." });
    }

    deletionInProgress = true;
    continuousDelete("updates");
    res.json({ message: "Started continuous deletion of Updates emails." });
});

// Route to stop deletion manually
app.post('/stop-deletion', (req, res) => {
    deletionInProgress = false;
    console.log("❌ Deletion has been stopped by the users.");
    io.emit("deletionStopped", { message: "Deletion process stopped." });
    res.json({ message: "Deletion process stopped." });
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
