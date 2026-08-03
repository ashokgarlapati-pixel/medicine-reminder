(async () => {
  try {
    const res = await fetch('http://localhost:5000/api/ai/generate-diet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportText: 'healthy' })
    });
    const text = await res.text();
    console.log(res.status, text);
  } catch(e) {
    console.error(e);
  }
})();
