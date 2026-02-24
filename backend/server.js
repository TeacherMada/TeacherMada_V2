
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const SUPABASE_URL = process.env.SUPABASE_URL;
// Attention: Sur le serveur, on utilise la SERVICE_ROLE_KEY pour avoir les droits d'admin (écrire les crédits)
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const aiClient = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

// --- MIDDLEWARE D'AUTHENTIFICATION ---
// Vérifie que la requête vient d'un utilisateur connecté via Supabase Frontend
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Token manquant" });

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return res.status(401).json({ error: "Utilisateur non authentifié" });
  
  req.user = user;
  next();
};

// --- ROUTES ---

// 1. CHAT GENERATION (Sécurisé & Payant)
app.post('/api/chat', authenticate, async (req, res) => {
  try {
    const { message, history, model } = req.body;
    const userId = req.user.id;

    // A. Vérifier les crédits
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    
    // Admin bypass credit check
    if (profile.role !== 'admin' && profile.credits < 1) {
       return res.status(402).json({ error: "INSUFFICIENT_CREDITS" });
    }

    // B. Appeler Gemini
    // Note: Pour simplifier, on utilise generateContent standard. 
    // Pour une production avancée, implémenter le stream.
    const selectedModel = model || 'gemini-2.0-flash';
    
    // Construction du prompt systeme (simplifié pour le backend, ou passé par le front)
    // Ici on fait confiance au contexte envoyé par le front pour garder la mémoire
    const chatHistory = history.map(h => ({
        role: h.role,
        parts: [{ text: h.text }]
    }));

    // Ajout du message actuel
    // chatHistory.push({ role: 'user', parts: [{ text: message }] });

    const chatSession = aiClient.chats.create({
        model: selectedModel,
        history: chatHistory
    });

    const result = await chatSession.sendMessage({ message });
    const responseText = result.text;

    // C. Déduire un crédit (Si pas admin)
    if (profile.role !== 'admin') {
        await supabase.from('profiles').update({ credits: profile.credits - 1 }).eq('id', userId);
    }

    // D. Sauvegarder l'historique dans Supabase (Optionnel, le front peut le faire aussi, 
    // mais le faire ici garantit la cohérence)
    await supabase.from('chat_history').insert([
        { user_id: userId, role: 'user', text: message, timestamp: Date.now() },
        { user_id: userId, role: 'model', text: responseText, timestamp: Date.now() }
    ]);

    res.json({ text: responseText });

  } catch (error) {
    console.error("Chat Error:", error);
    res.status(500).json({ error: "Erreur IA" });
  }
});

// 2. ADMIN - Valider une requête de crédits
app.post('/api/admin/approve', authenticate, async (req, res) => {
    const { requestId, status } = req.body; // 'approved'
    
    // Vérifier si l'utilisateur qui appelle est admin
    const { data: caller } = await supabase.from('profiles').select('role').eq('id', req.user.id).single();
    if (caller.role !== 'admin') return res.status(403).json({ error: "Accès interdit" });

    // Récupérer la demande
    const { data: request } = await supabase.from('admin_requests').select('*').eq('id', requestId).single();
    if (!request) return res.status(404).json({ error: "Demande introuvable" });

    if (status === 'approved' && request.type === 'credit') {
        // Ajouter les crédits à l'utilisateur cible
        const { data: targetUser } = await supabase.from('profiles').select('credits').eq('id', request.user_id).single();
        await supabase.from('profiles').update({ credits: targetUser.credits + request.amount }).eq('id', request.user_id);
    }

    // Mettre à jour le statut de la demande
    await supabase.from('admin_requests').update({ status }).eq('id', requestId);

    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TeacherMada Backend running on port ${PORT}`));
