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

// E-Mail senden via Gmail SMTP
async function sendEmail(data: { name: string; email: string; subject: string; message: string }): Promise<boolean> {
    // Gmail SMTP
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
        console.log('📧 Versuche Gmail SMTP zu verwenden...');
        console.log('📧 Gmail User:', process.env.GMAIL_USER);
        
        try {
            const transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                auth: {
                    user: process.env.GMAIL_USER,
                    pass: process.env.GMAIL_APP_PASSWORD
                }
            });

            await transporter.sendMail({
                from: `"GamerFeed Kontakt" <${process.env.GMAIL_USER}>`,
                to: process.env.GMAIL_USER,
                replyTo: data.email,
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
            return true;
        } catch (error) {
            console.error('❌ Gmail SMTP Fehler:', error);
            if (error instanceof Error) {
                console.error('Error Message:', error.message);
            }
            throw error;
        }
    }

    // Fallback: Nur loggen
    console.log('⚠️ Keine E-Mail-Konfiguration gefunden! Logge Nachricht:');
    console.log('📧 Kontaktformular erhalten:', data);
    return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    console.log('📬 Kontaktformular-Request erhalten');
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { name, email, subject, message, recaptchaToken } = req.body;

    // Validierung
    if (!name || !email || !subject || !message || !recaptchaToken) {
        console.log('❌ Fehlende Felder:', { 
            name: !!name, 
            email: !!email, 
            subject: !!subject, 
            message: !!message, 
            recaptchaToken: !!recaptchaToken 
        });
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    console.log('✅ Alle Felder vorhanden');
    console.log('📧 Von:', name, '<' + email + '>');
    console.log('📧 Betreff:', subject);

    // reCAPTCHA v3 prüfen
    const recaptchaResult = await verifyRecaptcha(recaptchaToken);
    if (!recaptchaResult.success || recaptchaResult.score < 0.5) {
        console.log('❌ reCAPTCHA fehlgeschlagen. Success:', recaptchaResult.success, 'Score:', recaptchaResult.score);
        return res.status(403).json({ error: 'Invalid captcha or bot detected', score: recaptchaResult.score });
    }
    console.log('✅ reCAPTCHA erfolgreich. Score:', recaptchaResult.score);

    // E-Mail senden
    try {
        console.log('📤 Starte E-Mail Versand...');
        const success = await sendEmail({ name, email, subject, message });
        
        if (success) {
            console.log('✅ Kontaktformular erfolgreich abgeschlossen');
            return res.status(200).json({ success: true });
        } else {
            console.log('❌ E-Mail Versand fehlgeschlagen');
            return res.status(500).json({ error: 'Failed to send email' });
        }
    } catch (error) {
        console.error('❌ Kritischer Fehler im Kontaktformular:', error);
        return res.status(500).json({ 
            error: 'Internal server error', 
            details: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
}
