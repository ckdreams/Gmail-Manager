const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);

oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

let lastDeletionTime = 0; // Store last deletion timestamp
const maxDeletesPerHour = 150; // Adjust based on observed quota behavior
let deletedEmailsCount = 0;
let deletionInProgress = false; // Track ongoing deletion operation

// Function to delete emails in batches with delay
async function deleteEmails(messages) {
    console.log(`Starting deletion process for ${messages.length} emails...`);
    
    let deletedEmails = [];
    for (let i = 0; i < messages.length; i++) {
        if (deletionInProgress === false) {
            console.log("❌ Deletion stopped by user.");
            return { message: "Deletion stopped by user.", deletedEmails };
        }

        try {
            await gmail.users.messages.delete({
                userId: 'me',
                id: messages[i].id,
            });
            deletedEmailsCount++;
            deletedEmails.push(messages[i].id);

            console.log(`✅ Deleted email ID: ${messages[i].id} (Total: ${deletedEmailsCount})`);

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

// Function to continuously delete "Promotions" emails
async function continuousDeletePromotions() {
    while (deletionInProgress) {
        try {
            console.log("Fetching more Promotions emails...");
            const listResponse = await gmail.users.messages.list({ userId: 'me', q: 'category:promotions' });

            if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
                console.log(`📭 No more Promotions emails found.`);
                deletionInProgress = false;
                return;
            }

            console.log(`Found ${listResponse.data.messages.length} Promotions emails. Deleting...`);
            const result = await deleteEmails(listResponse.data.messages);

            if (!deletionInProgress) {
                console.log("Stopping continuous deletion due to error.");
                return;
            }
        } catch (error) {
            if (error.code === 'ENOTFOUND') {
                console.error("No internet connection detected. Stopping process.");
                deletionInProgress = false;
            } else {
                console.error("❌ Error fetching Promotions emails:", error);
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
    continuousDeletePromotions();
    res.json({ message: "Started continuous deletion of Promotions emails." });
});

// Route to stop deletion manually
app.post('/stop-deletion', (req, res) => {
    deletionInProgress = false;
    console.log("❌ Deletion has been stopped by the users.");
    res.json({ message: "Deletion process stopped." });
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
