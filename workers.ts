export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('Hanya menerima POST', { status: 405 });

    const GAS_URL = "https://script.google.com/macros/s/AKfycbwNI_QGAfkN5jRydn_o8uU7-ARlr2_6POwg2CIRWy4qbSjYzOgnk9RNvE6Ew-II9II/exec?token=FKtBRIlu";

    try {
      const requestBody = await request.text();
      const signature = request.headers.get('Signature') || "";

      const url = new URL(GAS_URL);
      if (signature) url.searchParams.append('moota_signature', signature);

      // Google Apps Script SELALU redirect 302.
      // Kita harus ikuti redirect MANUAL sambil tetap kirim POST + body,
      // karena redirect default (follow) mengubah POST → GET dan body hilang.
      let targetUrl = url.toString();
      let response = new Response("No response", { status: 502 });
      let redirects = 0;

      while (redirects < 5) {
        response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: requestBody,
          redirect: 'manual'
        });

        // Jika bukan redirect, stop
        if (response.status < 300 || response.status >= 400) break;

        // Ambil URL redirect berikutnya
        const location = response.headers.get('Location');
        if (!location) break;
        targetUrl = location;
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
