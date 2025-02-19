import React, { useState, useEffect } from 'react';
import { io } from "socket.io-client";

const socket = io("http://localhost:3001", {
    transports: ["websocket"], // Ensure WebSocket is used instead of polling
    reconnectionAttempts: 5, // Retry connection
});

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [loginMessage, setLoginMessage] = useState('');
  const [query, setQuery] = useState('subject:unsubscribe');
  const [message, setMessage] = useState('');
  const [deletedEmails, setDeletedEmails] = useState([]);
  const [totalDeletedEmails, setTotalDeletedEmails] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    checkAuthentication();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchUserEmail();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    socket.on("emailDeleted", (data) => {
      console.log(`📥 Received emailDeleted event for ID: ${data.id}`);
      setDeletedEmails(prevEmails => [...prevEmails, data.id]);
    });

    socket.on("emailDeletedBatch", (data) => {
      console.log(`Received batch deletion event: ${data.count} emails deleted.`);
      setDeletedEmails(prevEmails => [...prevEmails, `Batch of ${data.count} emails deleted. Total: ${data.total}`]);
      setTotalDeletedEmails(data.total);
    });    

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

  const fetchUserEmail = async () => {
    try {
      const response = await fetch('http://localhost:3001/auth/user');
      const data = await response.json();
      if (data.email) {
        setUserEmail(data.email);
      }
    } catch (error) {
      console.error('Error fetching user email:', error);
    }
  };

  const checkAuthentication = async () => {
    try {
        const response = await fetch("http://localhost:3001/auth/check");
        const data = await response.json();
        setIsAuthenticated(data.isAuthenticated);

        if (data.isAuthenticated) {
            console.log("✅ User is authenticated.");
        } else {
            console.log("⚠️ User is NOT authenticated.");
        }
    } catch (error) {
        console.error("❌ Authentication check failed:", error);
    }
  };

  const loginWithGoogle = async () => {
    try {
      const response = await fetch("http://localhost:3001/auth/google");
      const data = await response.json();
      window.location.href = data.url;
    } catch (error) {
      console.error("Login failed:", error);
      setLoginMessage("Failed to start Google login.");
    }
  };

  const logout = async () => {
    try {
      await fetch('http://localhost:3001/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      // Reset local state
      setIsAuthenticated(false);
      setUserEmail('');
      setLoginMessage('');
      setMessage('');
      setDeletedEmails([]);
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

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

  // Disble UI elements is user is not authenticated or deletion is in progress
  const disableUI = !isAuthenticated || isDeleting;

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Gmail Bulk Email Deleter</h1>

      <div>
        <button
          onClick={isAuthenticated ? logout: loginWithGoogle}
          style={{
            backgroundColor: isAuthenticated ? 'gray' : 'green',
            color: 'white',
            padding: '10px'
          }}
        >
          {isAuthenticated ? 'Log Out' : 'Login with Google'}
        </button>
        {loginMessage && <p style={{ color: 'red' }}>{loginMessage}</p>}
      </div>

      {isAuthenticated ? (
        <div>
          <p>Logged in! You can now delete emails.</p>
          {userEmail && (
            <p>Currently managing email: <strong>{userEmail}</strong></p>
          )}
        </div>
      ) : (
        <p>Please log in to manage your Gmail.</p>
      )}

      <p>Enter a Gmail search query to target emails for deletion:</p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '300px' }}
        disabled={disableUI}
      />
      <button onClick={() => deleteEmails('delete-emails')} disabled={disableUI} style={{ marginLeft: '1rem' }}>
        Delete Emails
      </button>
      <button 
        onClick={() => deleteEmails('delete-promotions')} 
        disabled={disableUI} 
        style={{ marginLeft: '1rem', backgroundColor: 'red', color: 'white' }}>
        {disableUI ? "Deleting Promotions..." : "Delete Promotions Emails"}
      </button>
      <button
        onClick={() => deleteEmails('delete-updates')}
        disabled={disableUI}
        style={{ marginLeft: '1rem', backgroundColor: 'blue', color: 'white' }}>
        {disableUI ? "Deleting Updates..." : "Delete Updates Emails"}
      </button>
      <button onClick={stopDeletion} disabled={disableUI} style={{ marginLeft: '1rem', backgroundColor: 'gray' }}>
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