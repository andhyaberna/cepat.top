// Cloudflare Pages Function — handles POST /webhook/moota2
// Forwards Moota webhook to Google Apps Script endpoint B

interface Env {
  MOOTA2_GAS_URL: string;
  MOOTA2_TOKEN: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const signature = request.headers.get('Signature') || '';

    const targetUrl = new URL(env.MOOTA2_GAS_URL);
    targetUrl.searchParams.append('token', env.MOOTA2_TOKEN);
    targetUrl.searchParams.append('moota_signature', signature);

    const body = await request.text();

    const response = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    const resultText = await response.text();
    return new Response(resultText, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ status: 'error', message: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
