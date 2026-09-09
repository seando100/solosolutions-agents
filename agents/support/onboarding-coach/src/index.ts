import {
  agentLogger,
  getOpsClient,
} from '@solo/shared';
import type { AgentRunResult } from '@solo/shared';
import { createClient } from '@supabase/supabase-js';

/**
 * ===========================================
 * MORGAN -- Onboarding Coach
 * ===========================================
 *
 * "I watch every new signup and make sure they don't get lost.
 *  A gentle nudge at the right time makes all the difference."
 *
 * Team: Support (Per-Vertical)
 * Trigger: Daily at 9 AM ET (cron)
 *
 * Flow:
 *   1. Query professionals who signed up in the last 14 days
 *   2. Determine their activation stage
 *   3. Check which nudges have already been sent
 *   4. Send the appropriate nudge email via Resend
 *   5. Record the nudge to prevent duplicates
 *   6. Generate a daily onboarding summary
 *
 * Nudge schedule:
 *   Day 1: Welcome + finish setup / start trial / try first intake
 *   Day 3: Reminder based on where they stalled
 *   Day 7: Final check-in + what they're missing
 *   Day 14: HubSpot integration highlight
 *
 * All emails:
 *   - Bilingual (based on professional's locale)
 *   - Signed: "Morgan, Onboarding Coach -- SoloBusinessAI"
 *   - Sent via Resend (no-reply, transactional)
 *   - Respectful, friendly, not pushy
 * ===========================================
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'SoloBusinessAI <intake@solosolutionsai.com>';

type OnboardingStage = 'signed_up' | 'profile_complete' | 'subscribed' | 'activated';
type NudgeType =
  | 'day1_complete_profile' | 'day1_start_trial' | 'day1_try_intake'
  | 'day3_complete_profile' | 'day3_start_trial' | 'day3_customize'
  | 'day7_final_profile' | 'day7_activation'
  | 'day14_hubspot';

interface ProfessionalContext {
  id: string;
  email: string;
  legal_name: string;
  business_name: string;
  vanity_slug: string | null;
  subscription_status: string | null;
  logo_url: string | null;
  locale: string | null;
  vertical: string | null;
  created_at: string;
  intake_active: boolean;
}

// ── Email templates (EN + ES) ──────────────────────────────────────────────

const SUBJECT_LINES: Record<NudgeType, { en: string; es: string }> = {
  day1_complete_profile: {
    en: 'Your SoloBusinessAI account is almost ready',
    es: 'Su cuenta de SoloBusinessAI esta casi lista',
  },
  day1_start_trial: {
    en: 'Your 14-day free trial is waiting',
    es: 'Su prueba gratuita de 14 dias le espera',
  },
  day1_try_intake: {
    en: 'Try your new AI intake -- send yourself a test',
    es: 'Pruebe su nueva admision con IA -- enviese una prueba',
  },
  day3_complete_profile: {
    en: 'Quick reminder: your intake page is almost ready',
    es: 'Recordatorio: su pagina de admision esta casi lista',
  },
  day3_start_trial: {
    en: "Don't miss your free trial -- activate today",
    es: 'No pierda su prueba gratuita -- activela hoy',
  },
  day3_customize: {
    en: '3 ways to make your AI intake yours',
    es: '3 formas de personalizar su admision con IA',
  },
  day7_final_profile: {
    en: 'Your intake page is still waiting for you',
    es: 'Su pagina de admision aun le espera',
  },
  day7_activation: {
    en: 'One step away from your first client intake',
    es: 'A un paso de su primera admision de cliente',
  },
  day14_hubspot: {
    en: 'Keep track of every client inquiry -- automatically',
    es: 'Lleve un registro de cada consulta -- automaticamente',
  },
};

const NUDGE_BODIES: Record<NudgeType, { en: (name: string) => string; es: (name: string) => string }> = {
  day1_complete_profile: {
    en: (name) => `Hi ${name},

Welcome to SoloBusinessAI! You've taken the first step toward automating your client intake -- and it only takes a few minutes to finish setting up.

Your AI assistant is ready to start working for you. Just complete the setup wizard and you'll have a professional intake page that works 24/7, in English and Spanish.

Here's what you'll get once you're set up:
- An AI-powered intake conversation that captures exactly what you need from new clients
- Instant email notifications when someone reaches out
- A professional intake link you can share anywhere

To finish your setup, just log in at app.solosolutionsai.com and pick up where you left off.

If you have any questions at all, our support team is right inside your portal -- just click the chat icon.

Morgan, Onboarding Coach
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Bienvenido a SoloBusinessAI! Ha dado el primer paso para automatizar la admision de sus clientes -- y solo toma unos minutos completar la configuracion.

Su asistente de IA esta listo para trabajar para usted. Solo complete el asistente de configuracion y tendra una pagina de admision profesional que funciona las 24 horas, en ingles y espanol.

Esto es lo que obtendra una vez configurado:
- Una conversacion de admision con IA que captura exactamente lo que necesita de nuevos clientes
- Notificaciones instantaneas por correo cuando alguien se comunique
- Un enlace de admision profesional que puede compartir en cualquier lugar

Para completar su configuracion, inicie sesion en app.solosolutionsai.com y continue donde lo dejo.

Si tiene alguna pregunta, nuestro equipo de soporte esta dentro de su portal -- solo haga clic en el icono de chat.

Morgan, Coach de Incorporacion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  day1_start_trial: {
    en: (name) => `Hi ${name},

Your profile looks great! You're all set up and ready to start your 14-day free trial with full access to every feature.

During your trial you can:
- Generate AI-powered marketing ads for your business
- Create branded visual cards for social media
- Use the AI blog writer for your website
- Accept client intakes through chat and phone

A card is required to start your trial, but you will not be charged until day 15.

Morgan, Onboarding Coach
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Su perfil se ve excelente! Esta listo para comenzar su prueba gratuita de 14 dias con acceso completo a todas las funciones.

Durante su prueba puede:
- Generar anuncios de marketing con IA para su negocio
- Crear tarjetas visuales de marca para redes sociales
- Usar el escritor de blog con IA para su sitio web
- Recibir admisiones de clientes por chat y telefono

No se requiere tarjeta de credito para comenzar. Solo inicie sesion y su prueba comienza.

Morgan, Coach de Incorporacion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  day1_try_intake: {
    en: (name) => `Hi ${name},

Everything is set up and your AI intake is live! The best way to see it in action is to try it yourself.

Here's how: open your intake link (you'll find it in your admin portal) and submit a test inquiry. You'll see exactly what your clients experience -- and you'll get the email notification, AI summary, and everything else in real time.

It takes about 2 minutes and there's nothing to break. Give it a try!

Morgan, Onboarding Coach
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Todo esta configurado y su admision con IA esta activa! La mejor forma de verla en accion es probarla usted mismo.

Asi se hace: abra su enlace de admision (lo encontrara en su portal de administracion) y envie una consulta de prueba. Vera exactamente lo que experimentan sus clientes -- y recibira la notificacion por correo, el resumen de IA y todo lo demas en tiempo real.

Toma unos 2 minutos y no hay nada que pueda salir mal. Pruebelo!

Morgan, Coach de Incorporacion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  day3_complete_profile: {
    en: (name) => `Hi ${name},

Just checking in -- your SoloBusinessAI account is waiting for you. You started the setup but haven't finished yet, and I wanted to make sure nothing got in the way.

The setup wizard saves your progress, so you can pick up right where you left off. It only takes a few minutes to complete.

Once you're done, you'll have a professional AI intake page ready to share with potential clients.

Need help? Just click the chat icon inside your portal and our support team will walk you through it.

Morgan, Onboarding Coach
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Solo queria verificar -- su cuenta de SoloBusinessAI le espera. Comenzo la configuracion pero aun no la ha terminado, y queria asegurarme de que nada se interpuso.

El asistente de configuracion guarda su progreso, asi que puede continuar donde lo dejo. Solo toma unos minutos completarlo.

Una vez terminado, tendra una pagina de admision profesional con IA lista para compartir con clientes potenciales.

Necesita ayuda? Solo haga clic en el icono de chat dentro de su portal y nuestro equipo de soporte le guiara.

Morgan, Coach de Incorporacion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  day3_start_trial: {
    en: (name) => `Hi ${name},

Your SoloBusinessAI profile is ready -- but you haven't activated your free trial yet. You get 14 days with full access to everything. A card is required to start, and you will not be charged until day 15.

That includes AI-powered marketing ads, branded social media cards, blog generation, and of course the AI intake that works around the clock for you.

Just log in to get started. Your trial clock starts when you do.

Morgan, Onboarding Coach
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Su perfil de SoloBusinessAI esta listo -- pero aun no ha activado su prueba gratuita. Tiene 14 dias con acceso completo a todo. Se requiere una tarjeta para comenzar y no se le cobrara hasta el dia 15.

Eso incluye anuncios de marketing con IA, tarjetas de marca para redes sociales, generacion de blog y, por supuesto, la admision con IA que trabaja las 24 horas para usted.

Solo inicie sesion para comenzar. Su prueba comienza cuando usted lo haga.

Morgan, Coach de Incorporacion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  day3_customize: {
    en: (name) => `Hi ${name},

You're up and running on SoloBusinessAI -- great start! Here are 3 things you can do to make it truly yours:

1. Customize your intake questions -- tailor what you ask new clients based on your specialty
2. Upload your logo -- your intake page and marketing materials will carry your brand
3. Connect your calendar -- let clients book consultations right after their intake

All of these are in your Profile Settings inside the admin portal. Each one takes less than a minute.

Morgan, Onboarding Coach
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Ya esta activo en SoloBusinessAI -- excelente comienzo! Aqui hay 3 cosas que puede hacer para personalizarlo:

1. Personalice sus preguntas de admision -- adapte lo que le pregunta a nuevos clientes segun su especialidad
2. Suba su logotipo -- su pagina de admision y materiales de marketing llevaran su marca
3. Conecte su calendario -- permita que los clientes agenden consultas justo despues de su admision

Todo esto esta en la Configuracion de Perfil dentro de su portal de administracion. Cada uno toma menos de un minuto.

Morgan, Coach de Incorporacion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  day7_final_profile: {
    en: (name) => `Hi ${name},

It's been a week since you signed up for SoloBusinessAI, and I noticed you haven't finished setting up your account yet.

I understand things get busy. Your progress is saved and waiting for you -- it only takes a few minutes to complete.

If something wasn't clear or you ran into an issue, I'd love to help. Click the chat icon in your portal and our team will sort it out.

Your AI intake page is ready to start working for you. Let's get it live.

Morgan, Onboarding Coach
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Ha pasado una semana desde que se registro en SoloBusinessAI, y note que aun no ha terminado de configurar su cuenta.

Entiendo que las cosas se ponen ocupadas. Su progreso esta guardado y esperandole -- solo toma unos minutos completarlo.

Si algo no quedo claro o tuvo algun problema, me encantaria ayudar. Haga clic en el icono de chat en su portal y nuestro equipo lo resolvera.

Su pagina de admision con IA esta lista para trabajar para usted. Pongamosla en marcha.

Morgan, Coach de Incorporacion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  day7_activation: {
    en: (name) => `Hi ${name},

You're all set up on SoloBusinessAI -- your AI intake page is live and ready. The only thing missing is your first client inquiry.

Here are a few ways to start getting intakes:
- Share your intake link on your website or social media
- Add the chat widget to your existing site (just one line of code)
- Send your intake link directly to prospective clients

You can find your intake link and widget code in your admin portal under Profile Settings.

Once that first intake comes in, you'll see the full picture -- AI summary, conversation transcript, context notes, and instant email notification.

Morgan, Onboarding Coach
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Esta todo configurado en SoloBusinessAI -- su pagina de admision con IA esta activa y lista. Lo unico que falta es su primera consulta de cliente.

Algunas formas de comenzar a recibir admisiones:
- Comparta su enlace de admision en su sitio web o redes sociales
- Agregue el widget de chat a su sitio existente (solo una linea de codigo)
- Envie su enlace de admision directamente a clientes potenciales

Puede encontrar su enlace de admision y codigo del widget en su portal de administracion en Configuracion de Perfil.

Cuando llegue esa primera admision, vera todo el panorama -- resumen de IA, transcripcion de conversacion, notas de contexto y notificacion instantanea por correo.

Morgan, Coach de Incorporacion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  day14_hubspot: {
    en: (name) => `Hi ${name},

Quick tip that a lot of our professionals love: you can automatically keep track of every client inquiry in one organized place.

When someone reaches out through your AI intake, their information -- name, contact details, what they need, and the AI summary -- can flow automatically into a clean, searchable contact list. No spreadsheets. No sticky notes. No lost leads.

This works through a free tool called HubSpot, and connecting it takes about 30 seconds:

1. Go to Profile Settings in your admin portal
2. Scroll to Integrations
3. Click "Connect HubSpot"
4. That's it -- every new intake flows in automatically from that point

It's completely free and you can disconnect it anytime.

Morgan, Onboarding Coach
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Un consejo rapido que a muchos de nuestros profesionales les encanta: puede llevar un registro automatico de cada consulta de cliente en un solo lugar organizado.

Cuando alguien se comunica a traves de su admision con IA, su informacion -- nombre, datos de contacto, lo que necesita y el resumen de IA -- puede fluir automaticamente a una lista de contactos limpia y con busqueda. Sin hojas de calculo. Sin notas adhesivas. Sin clientes perdidos.

Esto funciona a traves de una herramienta gratuita llamada HubSpot, y conectarla toma unos 30 segundos:

1. Vaya a Configuracion de Perfil en su portal de administracion
2. Desplacese hasta Integraciones
3. Haga clic en "Conectar HubSpot"
4. Eso es todo -- cada nueva admision fluye automaticamente desde ese momento

Es completamente gratis y puede desconectarlo en cualquier momento.

Morgan, Coach de Incorporacion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
};

// ── Helper: send email via Resend ──────────────────────────────────────────

async function sendNudgeEmail(to: string, subject: string, body: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      text: body,
    }),
  });

  return response.ok;
}

// ── Helper: determine stage ────────────────────────────────────────────────

function determineStage(pro: ProfessionalContext, intakeCount: number): OnboardingStage {
  if (intakeCount > 0) return 'activated';
  if (pro.subscription_status === 'active' || pro.subscription_status === 'trialing') return 'subscribed';
  if (pro.vanity_slug) return 'profile_complete';
  return 'signed_up';
}

// ── Helper: determine which nudge to send ──────────────────────────────────

function determineNudge(daysSinceSignup: number, stage: OnboardingStage): NudgeType | null {
  if (stage === 'activated') return null; // Already activated -- stop nudging

  if (daysSinceSignup >= 1 && daysSinceSignup < 3) {
    if (stage === 'signed_up') return 'day1_complete_profile';
    if (stage === 'profile_complete') return 'day1_start_trial';
    if (stage === 'subscribed') return 'day1_try_intake';
  }

  if (daysSinceSignup >= 3 && daysSinceSignup < 7) {
    if (stage === 'signed_up') return 'day3_complete_profile';
    if (stage === 'profile_complete') return 'day3_start_trial';
    if (stage === 'subscribed') return 'day3_customize';
  }

  if (daysSinceSignup >= 7 && daysSinceSignup < 14) {
    if (stage === 'signed_up') return 'day7_final_profile';
    return 'day7_activation';
  }

  if (daysSinceSignup >= 14 && daysSinceSignup < 21) {
    return 'day14_hubspot';
  }

  return null;
}

// ── Main run function ──────────────────────────────────────────────────────

export async function run(runId: string): Promise<AgentRunResult> {
  const log = agentLogger('morgan', runId);
  const ops = getOpsClient();

  // Use the platform Supabase for reading professional data
  const platformUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const platformKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!platformUrl || !platformKey) {
    log.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return { summary: 'Error: missing platform credentials' };
  }
  const platform = createClient(platformUrl, platformKey);

  log.info('Starting onboarding check...');

  // ── 1. Query recent signups (last 21 days to cover day 14 HubSpot nudge) ──
  const cutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
  const { data: professionals, error: queryError } = await platform
    .from('professional_profiles')
    .select('id, email, legal_name, business_name, vanity_slug, subscription_status, logo_url, locale, vertical, created_at, intake_active')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true });

  if (queryError) {
    log.error({ err: queryError }, 'Failed to query professionals');
    return { summary: `Error: ${queryError.message}` };
  }

  if (!professionals || professionals.length === 0) {
    log.info('No recent signups in the onboarding window');
    return { summary: 'No recent signups to nudge' };
  }

  log.info({ count: professionals.length }, `Found ${professionals.length} professional(s) in onboarding window`);

  // ── 2. Get intake counts for all professionals ──
  const proIds = professionals.map(p => p.id);
  const { data: intakeCounts } = await platform
    .from('client_intakes')
    .select('professional_id')
    .in('professional_id', proIds);

  const intakeCountMap: Record<string, number> = {};
  (intakeCounts || []).forEach(row => {
    intakeCountMap[row.professional_id] = (intakeCountMap[row.professional_id] || 0) + 1;
  });

  // ── 3. Get already-sent nudges ──
  const { data: sentNudges } = await ops
    .from('onboarding_nudges')
    .select('professional_id, nudge_type')
    .in('professional_id', proIds);

  const sentSet = new Set(
    (sentNudges || []).map(n => `${n.professional_id}_${n.nudge_type}`)
  );

  // ── 4. Process each professional ──
  let nudgesSent = 0;
  let skipped = 0;
  const stageCounts: Record<string, number> = {};

  for (const pro of professionals as ProfessionalContext[]) {
    const intakeCount = intakeCountMap[pro.id] || 0;
    const stage = determineStage(pro, intakeCount);

    stageCounts[stage] = (stageCounts[stage] || 0) + 1;

    // Skip if already activated
    if (stage === 'activated') { skipped++; continue; }

    // Skip if intake paused
    if (pro.intake_active === false) { skipped++; continue; }

    // Skip if canceled
    if (pro.subscription_status === 'canceled') { skipped++; continue; }

    const daysSinceSignup = Math.floor(
      (Date.now() - new Date(pro.created_at).getTime()) / (24 * 60 * 60 * 1000)
    );

    const nudgeType = determineNudge(daysSinceSignup, stage);
    if (!nudgeType) { continue; }

    // Skip if already sent
    const nudgeKey = `${pro.id}_${nudgeType}`;
    if (sentSet.has(nudgeKey)) { continue; }

    // ── Determine language ──
    const lang = (pro.locale || '').startsWith('es') ? 'es' : 'en';

    // ── Get name ──
    const firstName = (pro.legal_name || pro.business_name || '').split(' ')[0] || 'there';

    // ── Get email content ──
    const subject = SUBJECT_LINES[nudgeType][lang];
    const body = NUDGE_BODIES[nudgeType][lang](firstName);

    // ── Send ──
    try {
      const sent = await sendNudgeEmail(pro.email, subject, body);

      if (sent) {
        // Record the nudge
        await ops.from('onboarding_nudges').insert({
          professional_id: pro.id,
          vertical: pro.vertical || 'global',
          nudge_type: nudgeType,
          stage_at_send: stage,
          email_address: pro.email,
          sent_at: new Date().toISOString(),
        });

        nudgesSent++;
        log.info({
          professionalId: pro.id,
          nudgeType,
          stage,
          daysSinceSignup,
          lang,
        }, `Sent ${nudgeType} nudge to ${firstName}`);
      }
    } catch (err) {
      log.error({ err, professionalId: pro.id, nudgeType }, 'Failed to send nudge');
    }
  }

  // ── 5. Summary ──
  const summary = [
    `${professionals.length} professional(s) in window`,
    `${nudgesSent} nudge(s) sent`,
    `${skipped} skipped`,
    `Stages: ${Object.entries(stageCounts).map(([s, c]) => `${s}=${c}`).join(', ')}`,
  ].join('; ');

  log.info(summary);
  return { summary };
}
