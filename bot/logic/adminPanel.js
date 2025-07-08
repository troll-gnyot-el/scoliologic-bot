import {
    generateSubthemeButtons,
    getLimbLevelKeyByIdx,
    isAdmin,
    generateAddSubthemeButtons,
    getAllLimbLevels,
    getLimbLevelByIdx,
    // findThemeById
} from "../helpers/functions.js";
import fs from "fs";
import { adminStates } from "../helpers/stateController.js";
import { LIMBS } from "../helpers/consts.js";

/*
Логика работы (по шагам)
1. Админ выбирает действие:
    - Добавить/заменить видео в существующей теме
    - Создать новую подтему

2. Если "добавить/заменить видео":
    - Навигация по дереву тем (по уровням)
    - Выбор конечности и уровня ампутации
    - Если видео уже есть — предложить заменить или оставить
    - Если нет — предложить добавить
    - После добавления/замены — сохранить изменения в JSON

3. Если "создать новую подтему":
    - Ввод названия новой подтемы
    - Поочередно предложить добавить видео по всем уровням ампутации и конечностям (с возможностью пропуска)
    - Видео сохраняются в videos_by_level новой подтемы
    - Подтема добавляется в раздел "Выберите интересующий Вас вопрос" соответствующей конечности
    - Сохранить изменения в JSON
* */

export function adminPanelLogic(bot, logicLoader, logicFilePath) {
    // --- Стартовое меню ---
    bot.onText(/\/admin/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAdmin(msg.from.username)) {
            return bot.sendMessage(chatId, "Нет прав администратора.");
        }

        adminStates.set(chatId, { mode: "main_menu" });
        await bot.sendMessage(chatId, "🔧 **Админ-панель**\n\nЧто вы хотите сделать?", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📹 Добавить/заменить видео", callback_data: "admin_edit_video" }],
                    [{ text: "➕ Создать новую подтему", callback_data: "admin_new_subtheme" }],
                    [{ text: "📋 Просмотр структуры", callback_data: "admin_view_structure" }]
                ]
            },
            parse_mode: "Markdown"
        });
    });

    // --- Callback обработка ---
    bot.on("callback_query", async (cbq) => {
        const chatId = cbq.message.chat.id;
        if (!isAdmin(cbq.from.username)) return;

        let state = adminStates.get(chatId) || {};
        const data = cbq.data;

        try {
            // --- Просмотр структуры ---
// --- Просмотр структуры ---
            if (data === "admin_view_structure") {
                try {
                    const logic = logicLoader.getLogic();
                    const structureText = buildStructureText(logic.themes);

                    // Разбиваем на части если текст слишком длинный
                    const messageParts = splitLongMessage(structureText);

                    for (let i = 0; i < messageParts.length; i++) {
                        const partHeader = messageParts.length > 1 ? `📋 **Структура тем (${i + 1}/${messageParts.length}):**\n\n` : "📋 **Структура тем:**\n\n";

                        await bot.sendMessage(chatId, partHeader + messageParts[i], {
                            parse_mode: "Markdown",
                            reply_markup: i === messageParts.length - 1 ? {
                                inline_keyboard: [
                                    [{ text: "🏠 Главное меню", callback_data: "admin_main_menu" }]
                                ]
                            } : undefined
                        });

                        // Небольшая задержка между сообщениями
                        if (i < messageParts.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }

                } catch (error) {
                    console.error("Structure view error:", error);
                    await bot.sendMessage(chatId, "❌ Ошибка при генерации структуры. Попробуйте позже.", {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🏠 Главное меню", callback_data: "admin_main_menu" }]
                            ]
                        }
                    });
                }

                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Начало редактирования видео ---
            if (data === "admin_edit_video") {
                state = { mode: "edit_video_choose_limb" };
                adminStates.set(chatId, state);

                await bot.sendMessage(chatId, "🎯 **Редактирование видео**\n\nВыберите конечность:", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🦵 Ноги", callback_data: "admin_edit_limb_legs" }],
                            [{ text: "🦾 Руки", callback_data: "admin_edit_limb_arms" }],
                            [{ text: "🏠 Главное меню", callback_data: "admin_main_menu" }]
                        ]
                    },
                    parse_mode: "Markdown"
                });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Выбор конечности для редактирования ---
            if (data.startsWith("admin_edit_limb_")) {
                const limb = data.replace("admin_edit_limb_", "");
                state = { mode: "edit_video_navigate", limb, currentPath: [limb] };
                adminStates.set(chatId, state);

                const logic = logicLoader.getLogic();
                const limbTheme = logicLoader.findThemeById(limb, logic.themes);

                if (!limbTheme || !limbTheme.subthemes) {
                    await bot.sendMessage(chatId, "❌ Ошибка: тема конечности не найдена.");
                    return;
                }

                // Пропускаем уровень ампутации, сразу идем к вопросам
                const questionsTheme = logicLoader.findThemeById(`${limb}_questions`, limbTheme.subthemes);
                if (!questionsTheme) {
                    await bot.sendMessage(chatId, "❌ Ошибка: раздел вопросов не найден.");
                    return;
                }

                state.currentPath.push(questionsTheme.id);
                adminStates.set(chatId, state);

                const buttons = generateEditNavigationButtons(questionsTheme.subthemes);
                buttons.push([{ text: "🔙 Назад", callback_data: "admin_edit_video" }]);

                const limbName = limb === "legs" ? "Ноги" : "Руки";
                await bot.sendMessage(chatId, `📁 **${limbName} - Вопросы**\n\nВыберите тему для редактирования:`, {
                    reply_markup: { inline_keyboard: buttons },
                    parse_mode: "Markdown"
                });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Навигация по темам для редактирования ---
            if (data.startsWith("admin_edit_nav_")) {
                const themeId = data.replace("admin_edit_nav_", "");
                const logic = logicLoader.getLogic();
                const theme = logicLoader.findThemeById(themeId, logic.themes);

                if (!theme) {
                    await bot.sendMessage(chatId, "❌ Ошибка: тема не найдена.");
                    return;
                }

                state.currentPath.push(themeId);
                adminStates.set(chatId, state);

                // Если у темы есть videos_by_level - это конечная тема для редактирования
                if (theme.videos_by_level) {
                    state.editThemeId = themeId;
                    state.mode = "edit_video_choose_level";
                    adminStates.set(chatId, state);

                    const levels = LIMBS[state.limb].levels;
                    const buttons = levels.map(lvl => [{
                        text: lvl.title,
                        callback_data: `admin_edit_level_${lvl.id}`
                    }]);
                    buttons.push([{ text: "🔙 Назад", callback_data: `admin_edit_limb_${state.limb}` }]);

                    await bot.sendMessage(chatId, `🎬 **${theme.title}**\n\nВыберите уровень ампутации:`, {
                        reply_markup: { inline_keyboard: buttons },
                        parse_mode: "Markdown"
                    });
                    await bot.answerCallbackQuery(cbq.id);
                    return;
                }

                // Если у темы есть subthemes - показываем их
                if (theme.subthemes && theme.subthemes.length > 0) {
                    const buttons = generateEditNavigationButtons(theme.subthemes);
                    buttons.push([{ text: "🔙 Назад", callback_data: `admin_edit_limb_${state.limb}` }]);

                    await bot.sendMessage(chatId, `📁 **${theme.title}**\n\nВыберите подтему:`, {
                        reply_markup: { inline_keyboard: buttons },
                        parse_mode: "Markdown"
                    });
                    await bot.answerCallbackQuery(cbq.id);
                    return;
                }

                await bot.sendMessage(chatId, "❌ В этой теме нет видео для редактирования.");
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Выбор уровня ампутации для редактирования ---
            if (data.startsWith("admin_edit_level_")) {
                const levelId = data.replace("admin_edit_level_", "");
                state.editLevelId = levelId;
                state.mode = "edit_video_enter_url";
                adminStates.set(chatId, state);

                const logic = logicLoader.getLogic();
                const theme = logicLoader.findThemeById(state.editThemeId, logic.themes);

                if (!theme) {
                    await bot.sendMessage(chatId, "❌ Ошибка: тема не найдена.");
                    return;
                }

                const currentVideo = theme.videos_by_level?.[levelId] || null;
                const levelInfo = getLimbLevelByIdx(getAllLimbLevels().indexOf(levelId));

                let msg = `🎬 **Редактирование видео**\n\n`;
                msg += `**Тема:** ${theme.title}\n`;
                msg += `**Уровень:** ${levelInfo ? levelInfo.title : levelId}\n\n`;

                if (currentVideo) {
                    msg += `**Текущее видео:** ${currentVideo}\n\n`;
                    msg += `Введите новую ссылку или "-" чтобы оставить без изменений:`;
                } else {
                    msg += `Видео для этого уровня еще не добавлено.\nВведите ссылку или "-" чтобы пропустить:`;
                }

                await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Создание новой подтемы ---
            if (data === "admin_new_subtheme") {
                state = { mode: "add_choose_limb" };
                adminStates.set(chatId, state);

                await bot.sendMessage(chatId, "🆕 **Создание новой подтемы**\n\nДля какой конечности?", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🦵 Ноги", callback_data: "admin_add_limb_legs" }],
                            [{ text: "🦾 Руки", callback_data: "admin_add_limb_arms" }],
                            [{ text: "🏠 Главное меню", callback_data: "admin_main_menu" }]
                        ]
                    },
                    parse_mode: "Markdown"
                });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Выбор конечности для новой подтемы ---
            if (data.startsWith("admin_add_limb_")) {
                const limb = data.replace("admin_add_limb_", "");
                state = { mode: "add_choose_parent", limb };
                adminStates.set(chatId, state);

                const logic = logicLoader.getLogic();
                const limbTheme = logicLoader.findThemeById(limb, logic.themes);
                const questionsTheme = logicLoader.findThemeById(`${limb}_questions`, limbTheme?.subthemes || []);

                if (!questionsTheme) {
                    await bot.sendMessage(chatId, "❌ Раздел вопросов не найден.");
                    return;
                }

                const buttons = generateAddSubthemeButtons(questionsTheme.subthemes || []);
                buttons.push([{ text: "📁 В корень вопросов", callback_data: `admin_add_parent_${questionsTheme.id}` }]);
                buttons.push([{ text: "🔙 Назад", callback_data: "admin_new_subtheme" }]);

                const limbName = limb === "legs" ? "Ноги" : "Руки";
                await bot.sendMessage(chatId, `📂 **${limbName}**\n\nВыберите родительскую тему:`, {
                    reply_markup: { inline_keyboard: buttons },
                    parse_mode: "Markdown"
                });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Выбор родительской темы ---
            if (data.startsWith("admin_add_parent_") || data.startsWith("admin_add_subtheme_to_")) {
                const parentId = data.replace("admin_add_parent_", "").replace("admin_add_subtheme_to_", "");
                state.parentId = parentId;
                state.mode = "enter_subtheme_title";
                state.videos = {};
                adminStates.set(chatId, state);

                await bot.sendMessage(chatId, "✏️ **Введите название новой подтемы:**");
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Пропуск видео ---
            if (data.startsWith("admin_skip_video_")) {
                const idx = parseInt(data.replace("admin_skip_video_", ""), 10);
                if (!state.videos) state.videos = {};
                state.videos[getLimbLevelKeyByIdx(idx)] = "";
                await askNextVideo(bot, chatId, state, idx + 1, logicLoader, logicFilePath);
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Главное меню ---
            if (data === "admin_main_menu") {
                adminStates.set(chatId, { mode: "main_menu" });
                await bot.sendMessage(chatId, "🔧 **Админ-панель**\n\nЧто вы хотите сделать?", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "📹 Добавить/заменить видео", callback_data: "admin_edit_video" }],
                            [{ text: "➕ Создать новую подтему", callback_data: "admin_new_subtheme" }],
                            [{ text: "📋 Просмотр структуры", callback_data: "admin_view_structure" }]
                        ]
                    },
                    parse_mode: "Markdown"
                });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

        } catch (error) {
            console.error("Admin panel error:", error);
            await bot.sendMessage(chatId, "❌ Произошла ошибка. Попробуйте еще раз.");
            await bot.answerCallbackQuery(cbq.id);
        }
    });

    // --- Обработка текстовых сообщений ---
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        if (!isAdmin(msg.from.username)) return;
        if (msg.text?.startsWith('/')) return; // Игнорируем команды

        let state = adminStates.get(chatId);
        if (!state) return;

        try {
            // --- Ввод URL для редактирования видео ---
            if (state.mode === "edit_video_enter_url") {
                const logic = logicLoader.getLogic();
                const theme = logicLoader.findThemeById(state.editThemeId, logic.themes);

                if (!theme) {
                    await bot.sendMessage(chatId, "❌ Ошибка: тема не найдена.");
                    adminStates.set(chatId, { mode: "main_menu" });
                    return;
                }

                if (!theme.videos_by_level) theme.videos_by_level = {};

                if (msg.text === "-") {
                    await bot.sendMessage(chatId, "🔄 Изменения отменены.", {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🏠 Главное меню", callback_data: "admin_main_menu" }]
                            ]
                        }
                    });
                } else {
                    theme.videos_by_level[state.editLevelId] = msg.text;
                    fs.writeFileSync(logicFilePath, JSON.stringify(logic, null, 2), "utf-8");
                    await bot.sendMessage(chatId, "✅ Видео успешно обновлено!", {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🏠 Главное меню", callback_data: "admin_main_menu" }]
                            ]
                        }
                    });
                }
                adminStates.set(chatId, { mode: "main_menu" });
                return;
            }

            // --- Ввод названия новой подтемы ---
            if (state.mode === "enter_subtheme_title") {
                state.subthemeTitle = msg.text;
                state.mode = "add_videos";
                state.videoIdx = 0;
                if (!state.videos) state.videos = {};
                adminStates.set(chatId, state);

                await askNextVideo(bot, chatId, state, 0, logicLoader, logicFilePath);
                return;
            }

            // --- Ввод URL видео для новой подтемы ---
            if (state.mode === "add_videos") {
                const idx = state.videoIdx || 0;
                if (!state.videos) state.videos = {};

                const levelKey = getLimbLevelKeyByIdx(idx);
                if (levelKey) {
                    state.videos[levelKey] = msg.text === "-" ? "" : msg.text;
                    await askNextVideo(bot, chatId, state, idx + 1, logicLoader, logicFilePath);
                }
                return;
            }

        } catch (error) {
            console.error("Admin message error:", error);
            await bot.sendMessage(chatId, "❌ Произошла ошибка. Попробуйте еще раз.");
        }
    });

    // --- Вспомогательные функции ---
    function generateEditNavigationButtons(subthemes) {
        if (!subthemes || !Array.isArray(subthemes)) return [];
        return subthemes.map(theme => [{
            text: theme.title,
            callback_data: `admin_edit_nav_${theme.id}`
        }]);
    }

    function buildStructureText(themes, level = 0, maxDepth = 3) {
        if (!themes || !Array.isArray(themes) || level > maxDepth) return "";

        let text = "";
        const indent = "  ".repeat(level);

        themes.forEach(theme => {
            // Экранируем специальные символы для markdown
            const safeTitle = escapeMarkdown(theme.title);
            const safeId = escapeMarkdown(theme.id);

            text += `${indent}📁 ${safeTitle} \`${safeId}\`\n`;

            if (theme.videos_by_level && Object.keys(theme.videos_by_level).length > 0) {
                const videoCount = Object.keys(theme.videos_by_level).length;
                text += `${indent}  🎬 Видео: ${videoCount}\n`;
            }

            if (theme.subthemes && theme.subthemes.length > 0 && level < maxDepth) {
                text += buildStructureText(theme.subthemes, level + 1, maxDepth);
            }
        });

        return text;
    }

    async function askNextVideo(bot, chatId, state, idx, logicLoader, logicFilePath) {
        const allLevels = getAllLimbLevels();

        if (idx >= allLevels.length) {
            // Сохраняем новую подтему
            await saveNewSubtheme(bot, chatId, state, logicLoader, logicFilePath);
            return;
        }

        const levelData = getLimbLevelByIdx(idx);
        if (!levelData) {
            await askNextVideo(bot, chatId, state, idx + 1, logicLoader, logicFilePath);
            return;
        }

        const { limb, title } = levelData;
        const limbName = limb === "legs" ? "Ноги" : "Руки";

        state.mode = "add_videos";
        state.videoIdx = idx;
        adminStates.set(chatId, state);

        await bot.sendMessage(chatId,
            `🎬 **Добавление видео ${idx + 1}/${allLevels.length}**\n\n**${limbName} - ${title}**\n\nВведите ссылку на видео или "-" чтобы пропустить:`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "⏭️ Пропустить", callback_data: `admin_skip_video_${idx}` }]
                    ]
                },
                parse_mode: "Markdown"
            }
        );
    }

// Функция для экранирования markdown символов
    function escapeMarkdown(text) {
        if (!text) return "";
        return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    }

// Функция для разбивки длинного текста на части
    function splitLongMessage(text, maxLength = 3500) {
        if (text.length <= maxLength) return [text];

        const parts = [];
        const lines = text.split('\n');
        let currentPart = "";

        for (const line of lines) {
            if ((currentPart + line + '\n').length > maxLength) {
                if (currentPart) {
                    parts.push(currentPart.trim());
                    currentPart = line + '\n';
                } else {
                    // Если одна строка больше лимита, обрезаем её
                    parts.push(line.substring(0, maxLength - 3) + "...");
                }
            } else {
                currentPart += line + '\n';
            }
        }

        if (currentPart.trim()) {
            parts.push(currentPart.trim());
        }

        return parts;
    }

    async function saveNewSubtheme(bot, chatId, state, logicLoader, logicFilePath) {
        try {
            const logic = logicLoader.getLogic();
            const parentTheme = logicLoader.findThemeById(state.parentId, logic.themes);

            if (!parentTheme) {
                await bot.sendMessage(chatId, "❌ Ошибка: родительская тема не найдена.");
                adminStates.set(chatId, { mode: "main_menu" });
                return;
            }

            // Формируем videos_by_level (только непустые видео)
            const videos_by_level = {};
            if (state.videos) {
                Object.keys(state.videos).forEach(key => {
                    if (state.videos[key] && state.videos[key].trim() !== "") {
                        videos_by_level[key] = state.videos[key].trim();
                    }
                });
            }

            const newSubtheme = {
                id: `custom_${Date.now()}`,
                title: state.subthemeTitle,
                level: (parentTheme.level || 4) + 1,
                videos_by_level,
                subthemes: []
            };

            if (!parentTheme.subthemes) parentTheme.subthemes = [];
            parentTheme.subthemes.push(newSubtheme);

            fs.writeFileSync(logicFilePath, JSON.stringify(logic, null, 2), "utf-8");

            await bot.sendMessage(chatId, `✅ Подтема "${state.subthemeTitle}" успешно добавлена!`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🏠 Главное меню", callback_data: "admin_main_menu" }]
                    ]
                }
            });

            adminStates.set(chatId, { mode: "main_menu" });

        } catch (error) {
            console.error("Save subtheme error:", error);
            await bot.sendMessage(chatId, "❌ Ошибка при сохранении подтемы.");
            adminStates.set(chatId, { mode: "main_menu" });
        }
    }
}
