import React, { useState } from 'react';

function App() {
  const [query, setQuery] = useState('subject:unsubscribe');
  const [message, setMessage] = useState('');
  const [nextBatchTime, setNextBatchTime] = useState(null);

  const deleteEmails = async () => {
    try {
      const response = await fetch('http://localhost:3001/delete-emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();
      setMessage(data.message);

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
      {message && <p>{message}</p>}
      {nextBatchTime && <p>Next batch deletion avaiable at: {nextBatchTime}</p>}
    </div>
  );
}

export default App;