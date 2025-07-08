import {
    getLimbLevelKeyByIdx,
    isAdmin,
    generateAddSubthemeButtons,
    getAllLimbLevels,
    getLimbLevelByIdx,
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

    // --- Обработка загруженных видеофайлов ---
    bot.on("video", async (msg) => {
        const chatId = msg.chat.id;
        if (!isAdmin(msg.from.username)) return;

        const state = adminStates.get(chatId);
        if (!state) return;

        try {
            // --- Редактирование существующего видео ---
            if (state.mode === "edit_video_upload") {
                const logic = logicLoader.getLogic();
                const theme = logicLoader.findThemeById(state.editThemeId, logic.themes);

                if (!theme) {
                    await bot.sendMessage(chatId, "❌ Ошибка: тема не найдена.");
                    adminStates.set(chatId, { mode: "main_menu" });
                    return;
                }

                if (!theme.files_by_level) theme.files_by_level = {};

                // Сохраняем file_id видео
                theme.files_by_level[state.editLevelId] = msg.video.file_id;

                // Удаляем старое поле videos_by_level если есть
                if (theme.videos_by_level && theme.videos_by_level[state.editLevelId]) {
                    delete theme.videos_by_level[state.editLevelId];
                }

                fs.writeFileSync(logicFilePath, JSON.stringify(logic, null, 2), "utf-8");

                await bot.sendMessage(chatId, "✅ Видеофайл успешно загружен и сохранен!", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🏠 Главное меню", callback_data: "admin_main_menu" }]
                        ]
                    }
                });

                adminStates.set(chatId, { mode: "main_menu" });
                return;
            }

            // --- Добавление видео для новой подтемы ---
            if (state.mode === "add_video_upload") {
                const idx = state.videoIdx || 0;
                if (!state.files) state.files = {};

                const levelKey = getLimbLevelKeyByIdx(idx);
                if (levelKey) {
                    state.files[levelKey] = msg.video.file_id;
                    await askNextVideo(bot, chatId, state, idx + 1, logicLoader, logicFilePath);
                }
                return;
            }

        } catch (error) {
            console.error("Video upload error:", error);
            await bot.sendMessage(chatId, "❌ Ошибка при загрузке видео. Попробуйте еще раз.");
        }
    });

    // --- Callback обработка ---
    bot.on("callback_query", async (cbq) => {
        const chatId = cbq.message.chat.id;
        if (!isAdmin(cbq.from.username)) return;

        let state = adminStates.get(chatId) || {};
        const data = cbq.data;

        try {
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

                // Если у темы есть videos_by_level или files_by_level - это конечная тема
                if (theme.videos_by_level || theme.files_by_level) {
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
                state.mode = "edit_video_method";
                adminStates.set(chatId, state);

                const logic = logicLoader.getLogic();
                const theme = logicLoader.findThemeById(state.editThemeId, logic.themes);

                if (!theme) {
                    await bot.sendMessage(chatId, "❌ Ошибка: тема не найдена.");
                    return;
                }

                const currentVideo = theme.videos_by_level?.[levelId] || null;
                const currentFile = theme.files_by_level?.[levelId] || null;
                const levelInfo = getLimbLevelByIdx(getAllLimbLevels().indexOf(levelId));

                // Экранируем все специальные символы
                const safeThemeTitle = escapeMarkdownV2(theme.title);
                const safeLevelTitle = escapeMarkdownV2(levelInfo ? levelInfo.title : levelId);

                let msg = `🎬 *Редактирование видео*\n\n`;
                msg += `*Тема:* ${safeThemeTitle}\n`;
                msg += `*Уровень:* ${safeLevelTitle}\n\n`;

                if (currentVideo) {
                    // Экранируем URL для безопасного отображения
                    const safeUrl = escapeMarkdownV2(currentVideo);
                    msg += `*Текущая ссылка:*\n\`${safeUrl}\`\n\n`;
                }
                if (currentFile) {
                    msg += `*Текущий файл:* загружен\n\n`;
                }

                msg += `Выберите способ обновления видео:`;

                await bot.sendMessage(chatId, msg, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🎬 Загрузить видеофайл", callback_data: "admin_upload_file" }],
                            [{ text: "🔗 Ввести ссылку", callback_data: "admin_enter_url" }],
                            [{ text: "❌ Удалить видео", callback_data: "admin_delete_video" }],
                            [{ text: "🔙 Назад", callback_data: `admin_edit_limb_${state.limb}` }]
                        ]
                    },
                    parse_mode: "MarkdownV2"
                });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Выбор способа загрузки ---
            if (data === "admin_upload_file") {
                state.mode = "edit_video_upload";
                adminStates.set(chatId, state);

                await bot.sendMessage(chatId,
                    "📤 **Загрузка видеофайла**\n\n" +
                    "Отправьте видеофайл для сохранения.\n\n" +
                    "⚠️ **Ограничения Telegram:**\n" +
                    "• Максимальный размер: 2 ГБ\n" +
                    "• Поддерживаемые форматы: MP4, AVI, MOV и др.",
                    { parse_mode: "Markdown" }
                );
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            if (data === "admin_enter_url") {
                state.mode = "edit_video_enter_url";
                adminStates.set(chatId, state);

                await bot.sendMessage(chatId, "🔗 **Введите ссылку на видео или \"-\" чтобы оставить без изменений:**");
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            if (data === "admin_delete_video") {
                const logic = logicLoader.getLogic();
                const theme = logicLoader.findThemeById(state.editThemeId, logic.themes);

                if (theme) {
                    if (theme.videos_by_level && theme.videos_by_level[state.editLevelId]) {
                        delete theme.videos_by_level[state.editLevelId];
                    }
                    if (theme.files_by_level && theme.files_by_level[state.editLevelId]) {
                        delete theme.files_by_level[state.editLevelId];
                    }

                    fs.writeFileSync(logicFilePath, JSON.stringify(logic, null, 2), "utf-8");

                    await bot.sendMessage(chatId, "✅ Видео удалено!", {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🏠 Главное меню", callback_data: "admin_main_menu" }]
                            ]
                        }
                    });
                    adminStates.set(chatId, { mode: "main_menu" });
                }
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
                state.files = {};
                adminStates.set(chatId, state);

                await bot.sendMessage(chatId, "✏️ **Введите название новой подтемы:**");
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Выбор способа добавления видео для новой подтемы ---
            if (data.startsWith("admin_add_method_file_")) {
                const idx = parseInt(data.replace("admin_add_method_file_", ""), 10);
                state.videoIdx = idx;
                state.mode = "add_video_upload";
                adminStates.set(chatId, state);

                await bot.sendMessage(chatId,
                    "📤 **Загрузка видеофайла**\n\n" +
                    "Отправьте видеофайл или нажмите \"Пропустить\".\n\n" +
                    "⚠️ **Ограничения:** макс. 2 ГБ",
                    {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "⏭️ Пропустить", callback_data: `admin_skip_video_${idx}` }]
                            ]
                        }
                    }
                );
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            if (data.startsWith("admin_add_method_url_")) {
                const idx = parseInt(data.replace("admin_add_method_url_", ""), 10);
                state.videoIdx = idx;
                state.mode = "add_video_url";
                adminStates.set(chatId, state);

                const levelData = getLimbLevelByIdx(idx);
                const limbName = levelData.limb === "legs" ? "Ноги" : "Руки";

                await bot.sendMessage(chatId,
                    `🔗 **${limbName} - ${levelData.title}**\n\nВведите ссылку на видео или \"-\" чтобы пропустить:`,
                    {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "⏭️ Пропустить", callback_data: `admin_skip_video_${idx}` }]
                            ]
                        }
                    }
                );
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Пропуск видео ---
            if (data.startsWith("admin_skip_video_")) {
                const idx = parseInt(data.replace("admin_skip_video_", ""), 10);
                if (!state.videos) state.videos = {};
                if (!state.files) state.files = {};

                const levelKey = getLimbLevelKeyByIdx(idx);
                state.videos[levelKey] = "";
                state.files[levelKey] = "";

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
        if (msg.text?.startsWith('/')) return;

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

                    // Удаляем file_id если добавляем ссылку
                    if (theme.files_by_level && theme.files_by_level[state.editLevelId]) {
                        delete theme.files_by_level[state.editLevelId];
                    }

                    fs.writeFileSync(logicFilePath, JSON.stringify(logic, null, 2), "utf-8");
                    await bot.sendMessage(chatId, "✅ Ссылка на видео обновлена!", {
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
                if (!state.files) state.files = {};
                adminStates.set(chatId, state);

                await askNextVideo(bot, chatId, state, 0, logicLoader, logicFilePath);
                return;
            }

            // --- Ввод URL видео для новой подтемы ---
            if (state.mode === "add_video_url") {
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
            const safeTitle = escapeMarkdown(theme.title);
            const safeId = escapeMarkdown(theme.id);

            text += `${indent}📁 ${safeTitle} \`${safeId}\`\n`;

            // Подсчитываем видео (ссылки и файлы)
            let videoCount = 0;
            if (theme.videos_by_level) videoCount += Object.keys(theme.videos_by_level).length;
            if (theme.files_by_level) videoCount += Object.keys(theme.files_by_level).length;

            if (videoCount > 0) {
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
            `🎬 **Добавление видео ${idx + 1}/${allLevels.length}**\n\n**${limbName} - ${title}**\n\nВыберите способ добавления:`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📤 Загрузить файл", callback_data: `admin_add_method_file_${idx}` }],
                        [{ text: "🔗 Ввести ссылку", callback_data: `admin_add_method_url_${idx}` }],
                        [{ text: "⏭️ Пропустить", callback_data: `admin_skip_video_${idx}` }]
                    ]
                },
                parse_mode: "Markdown"
            }
        );
    }

    function escapeMarkdown(text) {
        if (!text) return "";
        return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    }

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

            // Формируем videos_by_level и files_by_level
            const videos_by_level = {};
            const files_by_level = {};

            if (state.videos) {
                Object.keys(state.videos).forEach(key => {
                    if (state.videos[key] && state.videos[key].trim() !== "") {
                        videos_by_level[key] = state.videos[key].trim();
                    }
                });
            }

            if (state.files) {
                Object.keys(state.files).forEach(key => {
                    if (state.files[key] && state.files[key].trim() !== "") {
                        files_by_level[key] = state.files[key].trim();
                    }
                });
            }

            const newSubtheme = {
                id: `custom_${Date.now()}`,
                title: state.subthemeTitle,
                level: (parentTheme.level || 4) + 1,
                subthemes: []
            };

            // Добавляем поля только если есть данные
            if (Object.keys(videos_by_level).length > 0) {
                newSubtheme.videos_by_level = videos_by_level;
            }
            if (Object.keys(files_by_level).length > 0) {
                newSubtheme.files_by_level = files_by_level;
            }

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

    // Функция для корректного экранирования MarkdownV2
    function escapeMarkdownV2(text) {
        if (!text) return "";
        return text.replace(/[_*[\]()~`>#+=|{}.!-\\]/g, '\\$&');
    }
}