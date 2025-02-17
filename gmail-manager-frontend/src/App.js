import React, { useState, useEffect } from 'react';
import { io } from "socket.io-client";

const socket = io("http://localhost:3001", {
    transports: ["websocket"], // Ensure WebSocket is used instead of polling
    reconnectionAttempts: 5, // Retry connection
});

function App() {
  const [query, setQuery] = useState('subject:unsubscribe');
  const [message, setMessage] = useState('');
  const [deletedEmails, setDeletedEmails] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    socket.on("emailDeleted", (data) => {
      console.log(`📥 Received emailDeleted event for ID: ${data.id}`);
      setDeletedEmails(prevEmails => [...prevEmails, data.id]);
    });

    socket.on("emailDeletedBatch", (data) => {
      console.log(`Received batch deletion event: ${data.count} emails deleted.`);
      setDeletedEmails(prevEmails => [...prevEmails, `Batch of ${data.count} emails deleted. Total: ${data.total}`]);
    })

    socket.on("deletionStopped", (data) => {
      console.log("🛑 Received deletionStopped event");
      setMessage(data.message);
      setIsDeleting(false);
    });

    return () => {
      socket.off("emailDeleted");
      socket.off("emailDeletedBatch");
      socket.off("deletionStopped");
    };
  }, []);

  const deleteEmails = async (endpoint) => {
    setDeletedEmails([]); // Reset previous session data
    setMessage("Deleting emails...");
    setIsDeleting(true);

    try {
      const response = await fetch(`http://localhost:3001/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(endpoint === 'delete-emails' ? { query } : {}),
      });

      const data = await response.json();
      setMessage(data.message);
      setIsDeleting(false);

      if (data.deletedEmails) {
        setDeletedEmails(data.deletedEmails);
      }

      if (data.message.includes("No internet connection") || data.message.includes("Rate limit exceeded")) {
        setIsDeleting(false);
      }
    } catch (error) {
      console.error('Error deleting emails:', error);
      setMessage('Error deleting emails');
      setIsDeleting(false);
    }
  };

  const stopDeletion = async () => {
    setMessage("Stopping deletion process...");
    setIsDeleting(false);
    try {
      const response = await fetch('http://localhost:3001/stop-deletion', {
        method: 'POST',
      });
      const data = await response.json();
      setMessage(data.message);
    } catch (error) {
      console.error('Error stopping deletion:', error);
      setMessage('Error stopping deletion');
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Gmail Bulk Email Deleter</h1>
      <p>Enter a Gmail search query to target emails for deletion:</p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '300px' }}
        disabled={isDeleting}
      />
      <button onClick={() => deleteEmails('delete-emails')} disabled={isDeleting} style={{ marginLeft: '1rem' }}>
        Delete Emails
      </button>
      <button 
        onClick={() => deleteEmails('delete-promotions')} 
        disabled={isDeleting} 
        style={{ marginLeft: '1rem', backgroundColor: 'red', color: 'white' }}>
        {isDeleting ? "Deleting Promotions..." : "Delete Promotions Emails"}
      </button>
      <button
        onClick={() => deleteEmails('delete-updates')}
        disabled={isDeleting}
        style={{ marginLeft: '1rem', backgroundColor: 'blue', color: 'white' }}>
        {isDeleting ? "Deleting Updates..." : "Delete Updates Emails"}
      </button>
      <button onClick={stopDeletion} style={{ marginLeft: '1rem', backgroundColor: 'gray' }}>
        Stop Deletion
      </button>
      
      {message && <p>{message}</p>}

      {deletedEmails.length > 0 && (
        <div>
          <h3>Deleted Emails ({deletedEmails.length}):</h3>
          <ul>
            {deletedEmails.map((emailId, index) => (
              <li key={index} style={{ color: 'green', fontWeight: 'bold' }}>
                ✅ {emailId}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;