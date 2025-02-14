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

// Set the refresh token (for personal use)
oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

// Initialize Gmail API client
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

let lastDeletionTime = 0; // Store last deletion timestamp
const maxDeletesPerHour = 50; // Adjust based on observed quota bahavior
let deletedEmailsCount = 0;

// Function to delete emails in batches with delay
async function deleteEmails(messages) {
    for (let i = 0; i < messages.length; i++) {
        if (deletedEmailsCount >= maxDeletesPerHour) {
            console.log("Reached deletion limit for this hour.");
            return "Quota exceeded. Try again later.";
        }

        try {
            await gmail.users.messages.delete({
                userId: 'me',
                id: messages[i].id,
            });
            deletedEmailsCount++;
            console.log(`Deleted email ID: ${messages[i].id}`);

            // Delay between requests to avoid rate limits (500ms per request)
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error(`Error deleting email ID: ${messages[i].id}`, error);
        }
    }
    return `${messages.length} emails deleted successfully`;
}

// Reset deleted count every hour
setInterval(() => {
    deletedEmailsCount = 0;
}, 3600000); // 1 hour

// Route to delete emails based on query with rate limit handling
app.post('/delete-emails', async (req, res) => {
    const currentTime = Date.now();
    if (currentTime - lastDeletionTime < 3600000 && deletedEmailsCount >= maxDeletesPerHour) {
        const nextAvailableTime = new Date(lastDeletionTime + 3600000).toLocaleTimeString();
        return res.json({ message: `Rate limit exceeded. Next batch at ${nextAvailableTime}.`});
    }

    try {
        // Use query provided by frontend or default to 'subject:unsubscribe'
        const query = req.body.query || 'subject:unsubscribe';

        // List emails matching the query
        const listResponse = await gmail.users.messages.list({
            userId: 'me',
            q: query,
        });

        if (listResponse.data.messages && listResponse.data.messages.length > 0) {
            const deletionMessage = await deleteEmails(listResponse.data.messages);
            lastDeletionTime = Date.now();
            res.json({ message: deletionMessage });
        } else {
            res.json({ message: 'No emails found matching the query' });
        }
    } catch (error) {
        console.error('Error deleting emails:', error);
        res.status(500).json({ error: 'Error deleting emails' });
    }
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));