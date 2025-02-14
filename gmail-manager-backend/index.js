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
const maxDeletesPerHour = 50; // Adjust based on observed quota behavior
let deletedEmailsCount = 0;

// Function to delete emails in batches with delay
async function deleteEmails(messages) {
    console.log(`Starting deletion process for ${messages.length} emails...`);
    
    let deletedEmails = [];
    for (let i = 0; i < messages.length; i++) {
        if (deletedEmailsCount >= maxDeletesPerHour) {
            console.log(`Rate limit reached. Stopping deletion at ${deletedEmailsCount} emails.`);
            return { message: "Quota exceeded. Try again later.", deletedEmails };
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
            console.error(`❌ Error deleting email ID: ${messages[i].id}`, error);
        }
    }
    
    console.log(`✅ Finished deletion process: ${deletedEmails.length} emails deleted.`);
    return { message: `${deletedEmails.length} emails deleted successfully`, deletedEmails };
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

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
