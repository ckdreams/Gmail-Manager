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

// Route to delete emails based on query
app.post('/delete-emails', async (req, res) => {
    try {
        // Use query provided by frontend or default to 'subject:unsubscribe'
        const query = req.body.query || 'subject:unsubscribe';

        // List emails matching the query
        const listResponse = await gmail.users.messages.list({
            userId: 'me',
            q: query,
        });

        if (listResponse.data.messages && listResponse.data.messages.length > 0) {
            const deletePromises = listResponse.data.messages.map((message) =>
                gmail.users.messages.delete({
                    userId: 'me',
                    id: message.id,
                })
            );

            await Promise.all(deletePromises);
            res.json({
                message: `${listResponse.data.messages.length} emails deleted successfully`,
            });
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