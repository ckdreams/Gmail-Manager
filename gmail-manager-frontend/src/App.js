import React, { useState } from 'react';

function App() {
  const [query, setQuery] = useState('subject:unsubscribe');
  const [message, setMessage] = useState('');
  const [deletedEmails, setDeletedEmails] = useState([]);
  const [nextBatchTime, setNextBatchTime] = useState(null);

  const deleteEmails = async (endpoint) => {
    setDeletedEmails([]); // Reset previous session data
    setMessage("Deleting emails...");

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

      if (data.deletedEmails) {
        setDeletedEmails(data.deletedEmails);
      }

      // Check if the message contains next batch time info
      if (data.message.includes('Next batch at')) {
        const time = data.message.match(/\d{1,2}:\d{2}:\d{2} [APM]{2}/);
        if (time) {
          setNextBatchTime(time[0]);
        }
      }
    } catch (error) {
      console.error('Error deleting emails:', error);
      setMessage('Error deleting emails');
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
      />
      <button onClick={deleteEmails} style={{ marginLeft: '1rem' }}>
        Delete Emails
      </button>
      <button onClick={() => deleteEmails('delete-promotions')} style={{ marginLeft: '1rem', backgroundColor: 'red', color: 'white' }}>
        Delete Promotions Emails
      </button>
      
      {message && <p>{message}</p>}
      {nextBatchTime && <p>Next batch deletion avaiable at: {nextBatchTime}</p>}

      {deletedEmails.length > 0 && (
        <div>
          <h3>Deleted Emails ({deletedEmails.length}):</h3>
          <ul>
            {deletedEmails.map((emailId, index) => (
              <li key={index}>{emailId}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;