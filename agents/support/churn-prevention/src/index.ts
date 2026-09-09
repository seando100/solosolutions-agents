import {
  agentLogger,
  getOpsClient,
} from '@solo/shared';
import type { AgentRunResult } from '@solo/shared';
import { createClient } from '@supabase/supabase-js';

/**
 * ===========================================
 * SAGE -- Retention Specialist
 * ===========================================
 *
 * "I watch for the signs that someone is slipping away.
 *  A well-timed check-in saves more accounts than any discount."
 *
 * Team: Support (Per-Vertical)
 * Trigger: Daily at 10 AM ET (cron)
 *
 * Monitors 5 churn signals:
 *   - Trial expiring (3 days or less)
 *   - Payment failed (past_due)
 *   - Zero intakes (14+ days subscribed, none received)
 *   - Intake paused (7+ days)
 *   - No activity (14+ days, active subscription)
 *
 * Exclusions:
 *   - Canceled subscriptions (already churned)
 *   - Professionals in first 14 days (Morgan's territory)
 *
 * All emails:
 *   - Bilingual (based on professional's locale)
 *   - Signed: "Sage, Retention Specialist -- SoloBusinessAI"
 *   - Sent via Resend (no-reply, transactional)
 *   - Empathetic, value-focused, not guilt-tripping
 *   - HIGH severity also alerts founder
 * ===========================================
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'SoloBusinessAI <intake@solosolutionsai.com>';
const FOUNDER_EMAIL = process.env.NOTIFICATION_EMAIL || 'sean@solosolutionsai.com';

type SignalType = 'trial_expiring' | 'payment_failed' | 'zero_intakes' | 'intake_paused' | 'no_activity';
type Severity = 'high' | 'medium' | 'low';

interface ChurnSignal {
  type: SignalType;
  severity: Severity;
  detail: string;
}

interface ProfessionalContext {
  id: string;
  email: string;
  legal_name: string;
  business_name: string;
  subscription_status: string | null;
  trial_ends_at: string | null;
  intake_active: boolean;
  locale: string | null;
  vertical: string | null;
  created_at: string;
  updated_at: string;
}

// ── Cooldown periods (days) ────────────────────────────────────────────────

const COOLDOWN_DAYS: Record<Severity, number> = {
  high: 3,
  medium: 7,
  low: 14,
};

// ── Subject lines (EN + ES) ───────────────────────────────────────────────

const SUBJECT_LINES: Record<SignalType, { en: string; es: string }> = {
  trial_expiring: {
    en: 'Your SoloBusinessAI trial is ending soon',
    es: 'Su prueba de SoloBusinessAI termina pronto',
  },
  payment_failed: {
    en: 'Action needed: update your payment method',
    es: 'Accion necesaria: actualice su metodo de pago',
  },
  zero_intakes: {
    en: 'Quick tip: get the most from your AI intake',
    es: 'Consejo rapido: aproveche al maximo su admision con IA',
  },
  intake_paused: {
    en: 'Ready to turn your intake page back on?',
    es: 'Listo para reactivar su pagina de admision?',
  },
  no_activity: {
    en: 'Your SoloBusinessAI account is ready when you are',
    es: 'Su cuenta de SoloBusinessAI le espera cuando este listo',
  },
};

// ── Email bodies (EN + ES) ─────────────────────────────────────────────────

const EMAIL_BODIES: Record<SignalType, { en: (name: string, detail: string) => string; es: (name: string, detail: string) => string }> = {
  trial_expiring: {
    en: (name, detail) => `Hi ${name},

Your SoloBusinessAI free trial ${detail}. I wanted to make sure you're aware so nothing catches you off guard.

During your trial you've had access to everything -- AI intake, marketing ads, blog generation, phone intake, and more. If you'd like to keep these tools working for you, just select a plan in your account settings.

If you're not sure which plan fits, here's a quick guide:
- Starter ($49/mo): Perfect if you're just starting to build your client pipeline
- Pro ($79/mo): Best value -- includes the Marketing Kit and intelligence reports
- Pro+ ($119/mo): Everything plus phone intake and unlimited intakes

No pressure at all. If now isn't the right time, your account stays available and you can reactivate anytime.

Sage, Retention Specialist
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name, detail) => `Hola ${name},

Su prueba gratuita de SoloBusinessAI ${detail}. Queria asegurarme de que este al tanto para que nada le tome por sorpresa.

Durante su prueba ha tenido acceso a todo -- admision con IA, anuncios de marketing, generacion de blog, admision telefonica y mas. Si desea mantener estas herramientas trabajando para usted, solo seleccione un plan en la configuracion de su cuenta.

Si no esta seguro de que plan le conviene:
- Starter ($49/mes): Perfecto si esta comenzando a construir su cartera de clientes
- Pro ($79/mes): Mejor valor -- incluye el Kit de Marketing e informes de inteligencia
- Pro+ ($119/mes): Todo mas admision telefonica y admisiones ilimitadas

Sin presion alguna. Si ahora no es el momento adecuado, su cuenta permanece disponible y puede reactivarla en cualquier momento.

Sage, Especialista en Retencion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  payment_failed: {
    en: (name) => `Hi ${name},

We had trouble processing your most recent payment for SoloBusinessAI. This usually happens when a card expires or the bank flags an unfamiliar charge.

To keep your account active and your AI intake running, please update your payment method:

1. Log in to your admin portal
2. Go to account settings
3. Click "Manage Subscription" to update your card

Your intake page is still live for now, but it may be paused if the payment isn't resolved soon.

If you have any questions or need help, our support team is inside your portal -- just click the chat icon.

Sage, Retention Specialist
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Tuvimos problemas al procesar su pago mas reciente de SoloBusinessAI. Esto generalmente ocurre cuando una tarjeta expira o el banco marca un cargo desconocido.

Para mantener su cuenta activa y su admision con IA funcionando, actualice su metodo de pago:

1. Inicie sesion en su portal de administracion
2. Vaya a configuracion de cuenta
3. Haga clic en "Gestionar Suscripcion" para actualizar su tarjeta

Su pagina de admision aun esta activa por ahora, pero puede pausarse si el pago no se resuelve pronto.

Si tiene alguna pregunta o necesita ayuda, nuestro equipo de soporte esta dentro de su portal -- solo haga clic en el icono de chat.

Sage, Especialista en Retencion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  zero_intakes: {
    en: (name) => `Hi ${name},

I noticed your AI intake has been set up for a while now but hasn't received any client inquiries yet. That's completely normal -- sometimes it just takes a little push to get things flowing.

Here are a few things that tend to work well:
- Add your intake link to your website's contact page
- Share it in your email signature
- Post it on your social media profiles
- Add the chat widget to your existing site (one line of code)

You can find your intake link and widget code in your admin portal under Profile Settings.

Once that first inquiry comes through, you'll see why professionals love this -- AI summary, conversation transcript, and instant notification, all hands-free.

Sage, Retention Specialist
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Note que su admision con IA lleva un tiempo configurada pero aun no ha recibido consultas de clientes. Eso es completamente normal -- a veces solo se necesita un pequeno empujon para que las cosas fluyan.

Algunas cosas que suelen funcionar bien:
- Agregue su enlace de admision a la pagina de contacto de su sitio web
- Compartalo en su firma de correo electronico
- Publicelo en sus perfiles de redes sociales
- Agregue el widget de chat a su sitio existente (una linea de codigo)

Puede encontrar su enlace de admision y codigo del widget en su portal de administracion en Configuracion de Perfil.

Cuando llegue esa primera consulta, vera por que a los profesionales les encanta -- resumen de IA, transcripcion de conversacion y notificacion instantanea, todo sin esfuerzo.

Sage, Especialista en Retencion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  intake_paused: {
    en: (name) => `Hi ${name},

I noticed your intake page has been paused for a while. Just wanted to check in -- if you turned it off intentionally, no worries at all!

But if it slipped your mind or you paused it temporarily, you can turn it back on in a couple of seconds:

1. Log in to your admin portal
2. Go to Profile Settings
3. Toggle your intake back to active

Your AI assistant is ready and waiting. When you're ready, it'll pick right back up.

Sage, Retention Specialist
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Note que su pagina de admision ha estado pausada por un tiempo. Solo queria verificar -- si la desactivo intencionalmente, no hay problema!

Pero si se le olvido o la pauso temporalmente, puede reactivarla en un par de segundos:

1. Inicie sesion en su portal de administracion
2. Vaya a Configuracion de Perfil
3. Active su admision nuevamente

Su asistente de IA esta listo y esperando. Cuando este listo, retomara justo donde lo dejo.

Sage, Especialista en Retencion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
  no_activity: {
    en: (name) => `Hi ${name},

It's been a little while since you've logged into SoloBusinessAI. I just wanted to let you know your account is fully active and your AI intake is still running for you around the clock.

If life got busy, we completely understand. Everything is exactly where you left it.

And if you haven't checked in recently, here are a couple of things you might have missed:
- The Marketing Kit now has over 100,000 ad configuration options
- You can generate AI blog posts for your website
- Your AI support assistant Clark is available 24/7 inside your portal

Whenever you're ready, we're here.

Sage, Retention Specialist
SoloBusinessAI

This is an automated message. For support, contact support@solosolutionsai.com`,
    es: (name) => `Hola ${name},

Ha pasado un tiempo desde que inicio sesion en SoloBusinessAI. Solo queria informarle que su cuenta esta completamente activa y su admision con IA sigue funcionando para usted las 24 horas.

Si la vida se puso ocupada, lo entendemos completamente. Todo esta exactamente donde lo dejo.

Y si no ha revisado recientemente, hay un par de cosas que podria haberse perdido:
- El Kit de Marketing ahora tiene mas de 100,000 opciones de configuracion de anuncios
- Puede generar publicaciones de blog con IA para su sitio web
- Su asistente de soporte con IA Clark esta disponible 24/7 dentro de su portal

Cuando este listo, aqui estamos.

Sage, Especialista en Retencion
SoloBusinessAI

Este es un mensaje automatizado. Para soporte, contacte support@solosolutionsai.com`,
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000));
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, text: body }),
  });
  return response.ok;
}

function detectSignals(pro: ProfessionalContext, intakeCount: number): ChurnSignal[] {
  const signals: ChurnSignal[] = [];

  // Trial expiring
  if (pro.subscription_status === 'trialing' && pro.trial_ends_at) {
    const days = daysUntil(pro.trial_ends_at);
    if (days <= 3 && days >= 0) {
      signals.push({
        type: 'trial_expiring',
        severity: 'high',
        detail: days === 0 ? 'expires today' : `expires in ${days} day(s)`,
      });
    }
  }

  // Payment failed
  if (pro.subscription_status === 'past_due') {
    signals.push({ type: 'payment_failed', severity: 'high', detail: 'Payment method declined' });
  }

  // Zero intakes (subscribed 14+ days, none received)
  if (intakeCount === 0 && daysSince(pro.created_at) >= 14 &&
      (pro.subscription_status === 'active' || pro.subscription_status === 'trialing')) {
    signals.push({
      type: 'zero_intakes', severity: 'medium',
      detail: `No intakes in ${daysSince(pro.created_at)} days`,
    });
  }

  // Intake paused 7+ days
  if (pro.intake_active === false && daysSince(pro.updated_at) >= 7) {
    signals.push({
      type: 'intake_paused', severity: 'medium',
      detail: `Intake paused for ${daysSince(pro.updated_at)} days`,
    });
  }

  // No activity 14+ days
  if (daysSince(pro.updated_at) >= 14 && pro.subscription_status === 'active') {
    signals.push({
      type: 'no_activity', severity: 'low',
      detail: `No activity for ${daysSince(pro.updated_at)} days`,
    });
  }

  return signals;
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function run(runId: string): Promise<AgentRunResult> {
  const log = agentLogger('sage', runId);
  const ops = getOpsClient();

  const platformUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const platformKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!platformUrl || !platformKey) {
    log.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return { summary: 'Error: missing platform credentials' };
  }
  const platform = createClient(platformUrl, platformKey);

  log.info('Starting retention scan...');

  // ── 1. Query subscribers past Morgan's window (14+ days old) ──
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: professionals, error: queryError } = await platform
    .from('professional_profiles')
    .select('id, email, legal_name, business_name, subscription_status, trial_ends_at, intake_active, locale, vertical, created_at, updated_at')
    .in('subscription_status', ['active', 'trialing', 'past_due'])
    .lt('created_at', cutoff);

  if (queryError) {
    log.error({ err: queryError }, 'Failed to query professionals');
    return { summary: `Error: ${queryError.message}` };
  }

  if (!professionals || professionals.length === 0) {
    log.info('No subscribers to scan');
    return { summary: 'No subscribers in retention window' };
  }

  log.info({ count: professionals.length }, `Scanning ${professionals.length} subscriber(s)`);

  // ── 2. Get intake counts ──
  const proIds = professionals.map(p => p.id);
  const { data: intakes } = await platform
    .from('client_intakes')
    .select('professional_id')
    .in('professional_id', proIds)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const intakeMap: Record<string, number> = {};
  (intakes || []).forEach(row => {
    intakeMap[row.professional_id] = (intakeMap[row.professional_id] || 0) + 1;
  });

  // ── 3. Get previously sent outreach ──
  const { data: previousOutreach } = await ops
    .from('churn_signals')
    .select('professional_id, signal_type, outreach_sent_at')
    .in('professional_id', proIds);

  const outreachMap: Record<string, string> = {};
  (previousOutreach || []).forEach(row => {
    if (row.outreach_sent_at) {
      outreachMap[`${row.professional_id}_${row.signal_type}`] = row.outreach_sent_at;
    }
  });

  // ── 4. Process each professional ──
  let emailsSent = 0;
  let signalsDetected = 0;
  const highSeverityAlerts: string[] = [];

  for (const pro of professionals as ProfessionalContext[]) {
    const intakeCount = intakeMap[pro.id] || 0;
    const signals = detectSignals(pro, intakeCount);

    if (signals.length === 0) continue;
    signalsDetected += signals.length;

    // Take the highest severity signal
    const priorityOrder: Severity[] = ['high', 'medium', 'low'];
    const topSignal = signals.sort((a, b) =>
      priorityOrder.indexOf(a.severity) - priorityOrder.indexOf(b.severity)
    )[0];

    // Check cooldown
    const key = `${pro.id}_${topSignal.type}`;
    const lastSent = outreachMap[key];
    if (lastSent) {
      const daysSinceLastSent = daysSince(lastSent);
      if (daysSinceLastSent < COOLDOWN_DAYS[topSignal.severity]) {
        continue; // Still in cooldown
      }
    }

    // Determine language
    const lang = (pro.locale || '').startsWith('es') ? 'es' : 'en';
    const firstName = (pro.legal_name || pro.business_name || '').split(' ')[0] || 'there';

    // Get email content
    const subject = SUBJECT_LINES[topSignal.type][lang];
    const body = EMAIL_BODIES[topSignal.type][lang](firstName, topSignal.detail);

    // Send
    try {
      const sent = await sendEmail(pro.email, subject, body);

      if (sent) {
        // Record signal + outreach
        await ops.from('churn_signals').upsert({
          professional_id: pro.id,
          vertical: pro.vertical || 'global',
          signal_type: topSignal.type,
          severity: topSignal.severity,
          detail: topSignal.detail,
          detected_at: new Date().toISOString(),
          outreach_sent_at: new Date().toISOString(),
          outreach_type: 'email',
        }, { onConflict: 'professional_id,signal_type' });

        emailsSent++;
        log.info({
          professionalId: pro.id,
          signalType: topSignal.type,
          severity: topSignal.severity,
          lang,
        }, `Sent ${topSignal.type} outreach to ${firstName}`);

        // Track high severity for founder alert
        if (topSignal.severity === 'high') {
          highSeverityAlerts.push(
            `${pro.business_name || pro.legal_name} (${pro.email}): ${topSignal.type} - ${topSignal.detail}`
          );
        }
      }
    } catch (err) {
      log.error({ err, professionalId: pro.id, signalType: topSignal.type }, 'Failed to send outreach');
    }
  }

  // ── 5. Alert founder about high-severity signals ──
  if (highSeverityAlerts.length > 0 && RESEND_API_KEY) {
    try {
      await sendEmail(
        FOUNDER_EMAIL,
        `[Sage] ${highSeverityAlerts.length} at-risk account(s) need attention`,
        `AT-RISK ACCOUNTS — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n\n` +
        highSeverityAlerts.map((a, i) => `${i + 1}. ${a}`).join('\n') +
        '\n\nThese accounts have HIGH severity churn signals. Review in the admin portal.\n\nSage, Retention Specialist\nSoloBusinessAI'
      );
      log.info({ count: highSeverityAlerts.length }, 'Sent founder alert for at-risk accounts');
    } catch (err) {
      log.error({ err }, 'Failed to send founder alert');
    }
  }

  // ── 6. Summary ──
  const summary = [
    `${professionals.length} subscriber(s) scanned`,
    `${signalsDetected} signal(s) detected`,
    `${emailsSent} outreach email(s) sent`,
    highSeverityAlerts.length > 0 ? `${highSeverityAlerts.length} HIGH severity alert(s)` : 'no high severity',
  ].join('; ');

  log.info(summary);
  return { summary };
}
