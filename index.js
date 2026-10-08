const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder 
} = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers
    ]
});

// Stockage temporaire des événements et sessions de choix de classe
let events = {};
const pendingSelections = new Map();

// API : Création d'un événement depuis le site web
app.post('/api/create-event', async (req, res) => {
    const { title, type, date, details, channelId } = req.body;
    const eventId = Date.now().toString();

    events[eventId] = { id: eventId, title, type, date, details, participants: [] };

    try {
        const channel = await client.channels.fetch(channelId);
        
        const embed = new EmbedBuilder()
            .setTitle(`📢 NOUVEL ÉVÉNEMENT : ${title}`)
            .setDescription(`**Type :** ${type}\n**Date :** ${date}\n**Détails :** ${details}`)
            .setColor(type.includes('PvE') ? 0x990000 : 0xc69214);

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`join_${eventId}_Tank`).setLabel('🛡️ Tank').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`join_${eventId}_Heal`).setLabel('🧪 Heal').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`join_${eventId}_DPS`).setLabel('⚔️ DPS').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`leave_${eventId}`).setLabel('❌ Désinscription').setStyle(ButtonStyle.Secondary)
        );

        await channel.send({ embeds: [embed], components: [buttons] });
        res.json({ success: true, event: events[eventId] });
    } catch (err) {
        console.error("Erreur Discord :", err);
        res.status(500).json({ error: "Erreur lors de l'envoi de l'événement sur Discord." });
    }
});

// API : Récupération des événements pour le site
app.get('/api/events', (req, res) => {
    res.json(Object.values(events));
});

// Gestion des interactions Discord (Boutons et Menu Déroulant)
client.on('interactionCreate', async interaction => {
    try {
        // 1. Gestion des clics sur les boutons (Tank, Heal, DPS, Leave)
        if (interaction.isButton()) {
            const [action, eventId, role] = interaction.customId.split('_');
            const evt = events[eventId];

            if (!evt) {
                return interaction.reply({ content: "Événement introuvable ou expiré.", ephemeral: true });
            }

            const username = interaction.member ? interaction.member.displayName : interaction.user.username;

            if (action === 'leave') {
                evt.participants = evt.participants.filter(p => p.username !== username);
                return interaction.reply({ content: "❌ Tu t'es désinscrit(e) de l'événement.", ephemeral: true });
            }

            if (action === 'join') {
                // Stocke temporairement le rôle choisi pour l'utilisateur
                pendingSelections.set(interaction.user.id, { eventId, role });

                // Liste des classes WoW Classic / Forever
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select_class')
                    .setPlaceholder('Choisis ta classe WoW...')
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('Guerrier').setValue('Guerrier').setEmoji('⚔️'),
                        new StringSelectMenuOptionBuilder().setLabel('Paladin').setValue('Paladin').setEmoji('🔨'),
                        new StringSelectMenuOptionBuilder().setLabel('Chasseur').setValue('Chasseur').setEmoji('🏹'),
                        new StringSelectMenuOptionBuilder().setLabel('Rogue / Voleur').setValue('Voleur').setEmoji('🗡️'),
                        new StringSelectMenuOptionBuilder().setLabel('Prêtre').setValue('Prêtre').setEmoji('✨'),
                        new StringSelectMenuOptionBuilder().setLabel('Chaman').setValue('Chaman').setEmoji('⚡'),
                        new StringSelectMenuOptionBuilder().setLabel('Mage').setValue('Mage').setEmoji('🔥'),
                        new StringSelectMenuOptionBuilder().setLabel('Démoniste').setValue('Démoniste').setEmoji('💀'),
                        new StringSelectMenuOptionBuilder().setLabel('Druide').setValue('Druide').setEmoji('🐾')
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);

                return interaction.reply({
                    content: `Tu as sélectionné le rôle **${role}**. Choisis maintenant ta classe :`,
                    components: [row],
                    ephemeral: true
                });
            }
        }

        // 2. Gestion de la sélection de la classe WoW dans le menu déroulant
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_class') {
            const selection = pendingSelections.get(interaction.user.id);
            if (!selection) {
                return interaction.reply({ content: "Session expirée. Clique à nouveau sur un bouton de rôle.", ephemeral: true });
            }

            const { eventId, role } = selection;
            const evt = events[eventId];

            if (!evt) {
                return interaction.reply({ content: "Événement introuvable.", ephemeral: true });
            }

            const chosenClass = interaction.values[0];
            const username = interaction.member ? interaction.member.displayName : interaction.user.username;

            // Retire l'ancienne inscription si existante
            evt.participants = evt.participants.filter(p => p.username !== username);

            // Ajoute le joueur avec son rôle et sa classe
            evt.participants.push({ username, role, wowClass: chosenClass });
            pendingSelections.delete(interaction.user.id);

            return interaction.update({
                content: `✅ Inscrit(e) en tant que **${username}** — Role: **${role}** (${chosenClass}) !`,
                components: []
            });
        }
    } catch (err) {
        console.error("Erreur interaction :", err);
    }
});

// Connexion du bot Discord
client.login(process.env.DISCORD_TOKEN);

// Démarrage du serveur web
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur prêt et à l'écoute sur le port ${PORT}`);
});