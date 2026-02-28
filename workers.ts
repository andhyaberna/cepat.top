export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('Hanya menerima POST', { status: 405 });

    // ⚠️ PASTIKAN INI ADALAH URL WEB APP DEPLOYMENT ANDA YANG PALING BARU!
    const GAS_URL = "https://script.google.com/macros/s/AKfycbzhD52PbDNyMEYH5ZRdpsPeE0-d5yQB1gFcptfQDhvcShav0LkQMTcXJb32ymmC_yIx/exec?token=2h3Rnc10";

    try {
      const requestBody = await request.text();
      const signature = request.headers.get('Signature') || "";
      const url = new URL(GAS_URL);
      if (signature) url.searchParams.append('moota_signature', signature);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: requestBody
      });

      // KITA TANGKAP JAWABAN ASLI DARI GOOGLE
      const gasResult = await response.text(); 
      
      // KITA TERUSKAN JAWABAN ASLI ITU KE MOOTA
      return new Response(gasResult, { status: 200 }); 
      
    } catch (error) {
      return new Response("Error CF: " + error.message, { status: 500 });
    }
  },
};