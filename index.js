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

// Initialisation d'Express
const app = express();
app.use(express.json());
app.use(cors());

// Initialisation du client Discord avec les intents requis
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

// Fonction pour générer l'embed mis à jour avec la liste des inscrits
function createEventEmbed(evt) {
    const tanks = evt.participants.filter(p => p.role === 'Tank').map(p => `• ${p.username} (${p.wowClass})`).join('\n') || 'Aucun';
    const heals = evt.participants.filter(p => p.role === 'Heal').map(p => `• ${p.username} (${p.wowClass})`).join('\n') || 'Aucun';
    const dps = evt.participants.filter(p => p.role === 'DPS').map(p => `• ${p.username} (${p.wowClass})`).join('\n') || 'Aucun';

    return new EmbedBuilder()
        .setTitle(`📢 NOUVEL ÉVÉNEMENT : ${evt.title}`)
        .setDescription(`**Type :** ${evt.type}\n**Date :** ${evt.date}\n**Détails :** ${evt.details}`)
        .setColor(evt.type.includes('PvE') ? 0x990000 : 0xc69214)
        .addFields(
            { name: `🛡️ Tanks (${evt.participants.filter(p => p.role === 'Tank').length})`, value: tanks, inline: true },
            { name: `🧪 Heals (${evt.participants.filter(p => p.role === 'Heal').length})`, value: heals, inline: true },
            { name: `⚔️ DPS (${evt.participants.filter(p => p.role === 'DPS').length})`, value: dps, inline: true }
        );
}

// API : Création d'un événement depuis le site web (Onglet Officier)
app.post('/api/create-event', async (req, res) => {
    const { title, type, date, details, channelId } = req.body;
    const eventId = Date.now().toString();

    events[eventId] = { id: eventId, title, type, date, details, participants: [] };

    try {
        const channel = await client.channels.fetch(channelId);
        const embed = createEventEmbed(events[eventId]);

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

// Interactions Discord (Boutons et Menu Déroulant)
client.on('interactionCreate', async interaction => {
    try {
        // 1. Clic sur un bouton (Tank, Heal, DPS, Leave)
        if (interaction.isButton()) {
            const [action, eventId, role] = interaction.customId.split('_');
            const evt = events[eventId];

            if (!evt) {
                return interaction.reply({ content: "Événement introuvable ou expiré.", ephemeral: true });
            }

            const username = interaction.member ? interaction.member.displayName : interaction.user.username;

            // Désinscription
            if (action === 'leave') {
                evt.participants = evt.participants.filter(p => p.username !== username);
                
                // Mettre à jour l'embed sur le message principal Discord
                await interaction.message.edit({ embeds: [createEventEmbed(evt)] });

                return interaction.reply({ content: "❌ Tu t'es désinscrit(e) de l'événement.", ephemeral: true });
            }

            // Inscription (Ouverture du menu de choix de classe)
            if (action === 'join') {
                pendingSelections.set(interaction.user.id, { eventId, role });

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

        // 2. Sélection de la classe dans le menu déroulant
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

            // Mettre à jour l'inscription du joueur
            evt.participants = evt.participants.filter(p => p.username !== username);
            evt.participants.push({ username, role, wowClass: chosenClass });
            pendingSelections.delete(interaction.user.id);

            // Mettre à jour l'embed principal Discord
            await interaction.channel.messages.fetch(interaction.message.reference?.messageId || interaction.message.id)
                .then(msg => msg.edit({ embeds: [createEventEmbed(evt)] }))
                .catch(() => {});

            return interaction.update({
                content: `✅ Inscrit(e) en tant que **${username}** — Role: **${role}** (${chosenClass}) !`,
                components: []
            });
        }
    } catch (err) {
        console.error("Erreur interaction :", err);
    }
});

// Connexion du bot Discord via le token
client.login(process.env.DISCORD_TOKEN);

// Démarrage du serveur web
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});