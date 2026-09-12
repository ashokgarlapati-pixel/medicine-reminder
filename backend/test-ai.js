(async () => {
  try {
    const res = await fetch('https://medicine-reminder-backend-k64i.onrender.com/api/ai/generate-diet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportText: 'healthy' })
    });

    const text = await res.text();
    console.log(res.status, text);
  } catch (e) {
    console.error(e);
  }
})();