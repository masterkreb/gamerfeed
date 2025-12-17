import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

// Google reCAPTCHA v3 Verifikation
async function verifyRecaptcha(token: string): Promise<{ success: boolean; score: number }> {
    console.log('🔐 Verifiziere reCAPTCHA...');
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`
    });

    const data = await response.json();
    console.log('🔐 reCAPTCHA Ergebnis:', { success: data.success, score: data.score, errors: data['error-codes'] });
    
    return {
        success: data.success === true,
        score: data.score || 0
    };
}

// E-Mail senden - Mehrere Optionen
async function sendEmail(data: { name: string; email: string; subject: string; message: string }) {
    // Option 1: Formspree (kostenlos, kein Setup)
    if (process.env.FORMSPREE_FORM_ID) {
        const response = await fetch(`https://formspree.io/f/${process.env.FORMSPREE_FORM_ID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: data.name,
                email: data.email,
                subject: data.subject,
                message: data.message
            })
        });
        return response.ok;
    }

    // Option 2: Gmail SMTP (mit Nodemailer)
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
        console.log('📧 Versuche Gmail SMTP zu verwenden...');
        console.log('📧 Gmail User:', process.env.GMAIL_USER);
        try {
            // Gmail SMTP Transporter erstellen
            const transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 587,
                secure: false, // TLS
                auth: {
                    user: process.env.GMAIL_USER,
                    pass: process.env.GMAIL_APP_PASSWORD
                }
            });

            // E-Mail senden
            await transporter.sendMail({
                from: `"GamerFeed Kontakt" <${process.env.GMAIL_USER}>`,
                to: process.env.GMAIL_USER, // An dich selbst
                replyTo: data.email, // Reply geht an Absender
                subject: `[GamerFeed Kontakt] ${data.subject}`,
                html: `
                    <h2>📧 Neue Kontaktanfrage von GamerFeed</h2>
                    <p><strong>Von:</strong> ${data.name}</p>
                    <p><strong>E-Mail:</strong> <a href="mailto:${data.email}">${data.email}</a></p>
                    <p><strong>Betreff:</strong> ${data.subject}</p>
                    <hr>
                    <h3>Nachricht:</h3>
                    <p style="white-space: pre-wrap;">${data.message}</p>
                    <hr>
                    <p style="color: #666; font-size: 12px;">
                        Diese E-Mail wurde über das Kontaktformular auf gamerfeed.vercel.app gesendet.
                    </p>
                `
            });

            console.log('✅ E-Mail erfolgreich gesendet via Gmail SMTP');
            return true;);
            console.error('Fehlerdetails:', error);
            if (error instanceof Error) {
                console.error('Error Message:', error.message);
                console.error('Error Stack:', error.stack);
            }
            throw error; // Fehler nach oben werfen für besseres Debugging
            console.error('❌ Gmail SMTP Fehler:', error);
            return false;
        }
    }

    // Option 3: Resend (falls du es später einrichten willst)
    if (process.env.RESEND_API_KEY) {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'GamerFeed Kontakt <noreply@yourdomain.com>',
                to: process.env.CONTACT_EMAIL,
                reply_to: data.email,
                subject: `[GamerFeed] ${data.subject}`,
                html: `
                    <h2>Neue Kontaktanfrage</h2>
                    <p><strong>Von:</strong> ${data.name} (${data.email})</p>
                    <p><strong>Betreff:</strong> ${data.subject}</p>
                    <hr>
                    <p>${data.message.replace(/\n/g, '<br>')}</p>
                `
            })
        });
        return response.ok;
    }

    // Fallback: Nur in Vercel Logs speichern (für Testing)
    console.log('📬 Kontaktformular-Request erhalten');
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { name, email, subject, message, recaptchaToken } = req.body;

    // Validierung
    if (!name || !email || !subject || !message || !recaptchaToken) {
        console.log('❌ Fehlende Felder:', { name: !!name, email: !!email, subject: !!subject, message: !!message, recaptchaToken: !!recaptchaToken });
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    consconsole.log('❌ reCAPTCHA fehlgeschlagen. Success:', recaptchaResult.success, 'Score:', recaptchaResult.score);
        return res.status(403).json({ error: 'Invalid captcha or bot detected', score: recaptchaResult.score });
    }
    console.log('✅ reCAPTCHA erfolgreich. Score:', recaptchaResult.score);onsole.log('📧 Von:', name, '<' + email + '>');
    console.log('📧 Betreff:', subject);onst { name, email, subject, message, recaptchaToken } = req.body;

    // Validierung
    if (!name || !email || !subject || !message || !recaptchaToken) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
ole.log('📤 Starte E-Mail Versand...');
        const success = await sendEmail({ name, email, subject, message });
        
        if (success) {
            console.log('✅ Kontaktformular erfolgreich abgeschlossen');
            return res.status(200).json({ success: true });
        } else {
            console.log('❌ E-Mail Versand fehlgeschlagen');
            return res.status(500).json({ error: 'Failed to send email' });
        }
    } catch (error) {
        console.error('❌ Kritischer Fehler im Kontaktformular:');
        console.error(error);
        if (error instanceof Error) {
            console.error('Message:', error.message);
            console.error('Stack:', error.stack);
        }
        return res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknownt, message });
        
        if (success) {
            return res.status(200).json({ success: true });
        } else {
            return res.status(500).json({ error: 'Failed to send email' });
        }
    } catch (error) {
        console.error('Contact form error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
