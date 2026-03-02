export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('Hanya menerima POST', { status: 405 });

    const GAS_URL = "https://script.google.com/macros/s/AKfycbwNI_QGAfkN5jRydn_o8uU7-ARlr2_6POwg2CIRWy4qbSjYzOgnk9RNvE6Ew-II9II/exec?token=FKtBRIlu";

    try {
      const requestBody = await request.text();

      // Forward Moota headers yang penting
      const signature = request.headers.get('Signature') || "";

      const url = new URL(GAS_URL);
      if (signature) url.searchParams.append('moota_signature', signature);

      // ============================================================
      // PENTING: Google Apps Script SELALU redirect 302.
      // Jika pakai redirect:'follow' (default), fetch mengubah POST→GET
      // dan body hilang. Solusi: redirect:'manual', ikuti sendiri.
      // ============================================================
      let response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: requestBody,
        redirect: 'manual'
      });

      // Ikuti redirect chain (GAS biasanya redirect 1-3x)
      let redirects = 0;
      while (response.status >= 300 && response.status < 400 && redirects < 5) {
        const location = response.headers.get('Location');
        if (!location) break;
        response = await fetch(location, { redirect: 'manual' });
        redirects++;
      }

      const gasResult = await response.text();
      return new Response(gasResult, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });

    } catch (error) {
      return new Response(JSON.stringify({
        error: true,
        message: "CF Worker Error: " + String(error)
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
};
