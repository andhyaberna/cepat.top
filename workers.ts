export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('Hanya menerima POST', { status: 405 });

    const GAS_URL = "https://script.google.com/macros/s/AKfycbynHJddXlflmcBJdIKPS_j-MrFs_gLz3kqwaIDGTvCKoHKilEfkepEuqCwVllvJadZ4/exec?token=FKtBRIlu";

    try {
      const requestBody = await request.text();
      const response = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: requestBody
      });

      const gasResult = await response.text();
      return new Response(gasResult, { status: 200 });

    } catch (error) {
      return new Response("Error CF: " + String(error), { status: 500 });
    }
  },
};
