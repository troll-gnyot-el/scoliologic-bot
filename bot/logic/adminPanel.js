import {
    generateSubthemeButtons,
    getLimbLevelKeyByIdx,
    isAdmin,
    askNextVideo, generateAddSubthemeButtons
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

export function adminPanelLogic(bot, logicLoader) {
    // --- Стартовое меню ---
    bot.onText(/\/admin/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAdmin(msg.from.username)) return bot.sendMessage(chatId, "Нет прав администратора.");

        adminStates.set(chatId, { mode: "main_menu" });
        await bot.sendMessage(chatId, "Что вы хотите сделать?", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Добавить/заменить видео в существующей теме", callback_data: "admin_edit_video" }],
                    [{ text: "Создать новую подтему", callback_data: "admin_new_subtheme" }]
                ]
            }
        });
    });

    // --- Callback обработка ---
    bot.on("callback_query", async (cbq) => {
        const chatId = cbq.message.chat.id;
        if (!isAdmin(cbq.from.username)) return;
        let state = adminStates.get(chatId) || {};

        // --- Универсальный обход для обновления видео ---
        if (cbq.data === "admin_edit_video") {
            state = { mode: "edit_video_choose_theme", path: [] };
            adminStates.set(chatId, state);

            const logic = logicLoader.getLogic();
            console.log("logic ", logic);
            const rootTheme = logic.themes.find(t => t.id === "t1");
            if (!rootTheme) {
                await bot.sendMessage(chatId, "Ошибка: корневая тема не найдена.");
                return;
            }
            const buttons = generateSubthemeButtons(rootTheme.subthemes);
            await bot.sendMessage(chatId, "Выберите тему:", {
                reply_markup: { inline_keyboard: buttons }
            });
            await bot.answerCallbackQuery(cbq.id);
            return;
        }

        // --- Рекурсивная навигация по темам для обновления видео ---
        if (cbq.data.startsWith("admin_edit_theme_")) {
            const themeId = cbq.data.replace("admin_edit_theme_", "");
            state.path = [...(state.path || []), themeId];
            adminStates.set(chatId, state);

            const logic = logicLoader.getLogic();
            const theme = logicLoader.findThemeByPath(logic.themes, state.path);

            console.log("")
            if (!theme) {
                await bot.sendMessage(chatId, "Ошибка: подтема не найдена.");
                return;
            }

            // Если есть videos_by_level — предлагаем обновить
            if (theme.videos_by_level) {
                state.themeId = theme.id;
                state.mode = "edit_video_choose_level";
                adminStates.set(chatId, state);

                // Определяем limb по пути (ищем "legs" или "arms" в path)
                const limb = state.path.find(id => id === "legs" || id === "arms");
                if (!limb) {
                    await bot.sendMessage(chatId, "Ошибка: не удалось определить конечность.");
                    return;
                }
                const levels = LIMBS[limb].levels;
                const buttons = levels.map(lvl => [{ text: lvl.title, callback_data: `admin_edit_level_${lvl.id}` }]);
                await bot.sendMessage(chatId, "Выберите уровень ампутации для обновления видео:", {
                    reply_markup: { inline_keyboard: buttons }
                });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // Если есть subthemes — показываем их для дальнейшего выбора
            if (theme.subthemes && theme.subthemes.length > 0) {
                const buttons = generateSubthemeButtons(theme.subthemes);
                await bot.sendMessage(chatId, "Выберите подтему:", {
                    reply_markup: { inline_keyboard: buttons }
                });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // Если ни видео, ни подтем — ошибка
            await bot.sendMessage(chatId, "В этой теме нельзя обновить видео и нет подтем.");
            await bot.answerCallbackQuery(cbq.id);
            return;
        }

        // --- Выбор уровня для обновления видео ---
        if (cbq.data.startsWith("admin_edit_level_")) {
            const levelId = cbq.data.replace("admin_edit_level_", "");
            state.levelId = levelId;
            state.mode = "edit_video_enter_url";
            adminStates.set(chatId, state);

            const logic = logicLoader.getLogic();
            const theme = logicLoader.findThemeByPath(logic.themes, state.path);

            const currentVideo = theme?.videos_by_level?.[levelId] || null;
            let msg = currentVideo
                ? `Текущее видео: ${currentVideo}\n\nВведите новую ссылку или "-" чтобы оставить без изменений:`
                : "Видео для этого уровня еще не добавлено. Введите ссылку или '-' чтобы пропустить:";
            await bot.sendMessage(chatId, msg);
            await bot.answerCallbackQuery(cbq.id);
            return;
        }

        // --- Добавление новой подтемы: выбор конечности ---
        if (cbq.data === "admin_new_subtheme") {
            state = { mode: "add_choose_limb" };
            adminStates.set(chatId, state);
            await bot.sendMessage(chatId, "Для какой конечности добавить подтему?", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Ноги", callback_data: "admin_add_limb_legs" }],
                        [{ text: "Руки", callback_data: "admin_add_limb_arms" }]
                    ]
                }
            });
            await bot.answerCallbackQuery(cbq.id);
            return;
        }

        // --- Добавление новой подтемы: рекурсивная навигация по подтемам ---
        if (cbq.data.startsWith("admin_add_limb_")) {
            const limb = cbq.data.replace("admin_add_limb_", "");
            state = { ...state, limb, mode: "add_choose_parent_theme" };
            adminStates.set(chatId, state);

            const logic = logicLoader.getLogic();
            const limbTheme = logic.themes[0].subthemes.find(t => t.id === limb);
            const questions = limbTheme?.subthemes.find(t => t.id === `${limb}_questions`);
            if (!questions || !questions.subthemes) {
                await bot.sendMessage(chatId, "Не найден список подтем.");
                return;
            }
            // Можно добавить в любую существующую подтему (на любом уровне)
            const buttons = generateAddSubthemeButtons(questions.subthemes);
            // Кнопка "Добавить в корень вопросов"
            buttons.push([{ text: "В корень", callback_data: `admin_add_subtheme_to_${questions.id}` }]);
            await bot.sendMessage(chatId, "Выберите родительскую подтему для новой темы:", {
                reply_markup: { inline_keyboard: buttons }
            });
            await bot.answerCallbackQuery(cbq.id);
            return;
        }

        // --- Добавление новой подтемы: выбор родителя ---
        if (cbq.data.startsWith("admin_add_subtheme_to_")) {
            const parentId = cbq.data.replace("admin_add_subtheme_to_", "");
            state = { ...state, parentId, mode: "enter_new_subtheme_title", videos: {}, videoIdx: 0 };
            adminStates.set(chatId, state);
            await bot.sendMessage(chatId, "Введите название новой подтемы:");
            await bot.answerCallbackQuery(cbq.id);
            return;
        }

        // --- Пропуск видео при создании новой подтемы ---
        if (cbq.data.startsWith("admin_skip_video_")) {
            const idx = parseInt(cbq.data.replace("admin_skip_video_", ""), 10);
            state = adminStates.get(chatId);
            state.videos[getLimbLevelKeyByIdx(idx)] = "";
            await askNextVideo(bot, chatId, state, idx + 1);
            adminStates.set(chatId, state);
            await bot.answerCallbackQuery(cbq.id);
            return;
        }
    });

    // --- Сообщения (текст) ---
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        if (!isAdmin(msg.from.username)) return;
        let state = adminStates.get(chatId);
        if (!state) return;

        // --- Ввод ссылки для редактирования видео ---
        if (state.mode === "edit_video_enter_url") {
            const logic = logicLoader.getLogic();
            const theme = logicLoader.findThemeByPath(logic.themes, state.path);

            if (!theme) {
                await bot.sendMessage(chatId, "Ошибка: подтема не найдена.");
                adminStates.set(chatId, { mode: "main_menu" });
                return;
            }
            if (!theme.videos_by_level) theme.videos_by_level = {};

            if (msg.text === "-") {
                await bot.sendMessage(chatId, "Изменения отменены, видео осталось прежним.");
            } else {
                theme.videos_by_level[state.levelId] = msg.text;
                fs.writeFileSync(logicLoader.filePath, JSON.stringify(logic, null, 2), "utf-8");
                await bot.sendMessage(chatId, "Видео обновлено!");
            }
            adminStates.set(chatId, { mode: "main_menu" });
            return;
        }

        // --- Ввод названия новой подтемы ---
        if (state.mode === "enter_new_subtheme_title") {
            state.subtheme = { title: msg.text };
            state.mode = "add_video_loop";
            state.videoIdx = 0;
            adminStates.set(chatId, state);
            await askNextVideo(bot, chatId, state, 0);
            return;
        }

        // --- Ввод ссылки на видео для нового уровня ---
        if (state.mode === "add_video_loop") {
            const idx = state.videoIdx || 0;
            state.videos[getLimbLevelKeyByIdx(idx)] = msg.text === "-" ? "" : msg.text;
            await askNextVideo(bot, chatId, state, idx + 1);
            return;
        }
    });
}


/*
import {
    getLimbLevelKeyByIdx,
    getLimbLevelByIdx,
    getAllLimbLevels,
    isAdmin
} from "../helpers/functions.js";
import fs from "fs";
import { adminStates } from "../helpers/stateController.js";
import { LIMBS } from "../helpers/consts.js";

/!*
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
* *!/

export function adminPanelLogic(bot, logicLoader) {
        // --- Стартовое меню ---
        bot.onText(/\/admin/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(msg.from.username)) return bot.sendMessage(chatId, "Нет прав администратора.");

            adminStates.set(chatId, { mode: "main_menu" });
            await bot.sendMessage(chatId, "Что вы хотите сделать?", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Добавить/заменить видео в существующей теме", callback_data: "admin_edit_video" }],
                        [{ text: "Создать новую подтему", callback_data: "admin_new_subtheme" }]
                    ]
                }
            });
        });

        // --- Callback обработка ---
        bot.on("callback_query", async (cbq) => {
            const chatId = cbq.message.chat.id;
            if (!isAdmin(cbq.from.username)) return;
            let state = adminStates.get(chatId) || {};

            // --- Редактирование видео в существующей теме ---
            if (cbq.data === "admin_edit_video") {
                state = { mode: "edit_video_choose_limb" };
                adminStates.set(chatId, state);

                await bot.sendMessage(chatId, "Для какой конечности?", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Ноги", callback_data: "admin_edit_limb_legs" }],
                            [{ text: "Руки", callback_data: "admin_edit_limb_arms" }]
                        ]
                    }
                });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Навигация по дереву для выбора темы (существующая тема) ---
            if (cbq.data.startsWith("admin_edit_limb_")) {
                const limb = cbq.data.replace("admin_edit_limb_", "");
                state = { ...state, limb, mode: "edit_video_choose_theme" };
                adminStates.set(chatId, state);

                // Найти "Выберите интересующий Вас вопрос" для выбранной конечности
                const logic = logicLoader.getLogic();
                const limbTheme = logic.themes[0].subthemes.find(t => t.id === limb);
                const questions = limbTheme?.subthemes.find(t => t.id === `${limb}_questions`);
                if (!questions || !questions.subthemes) {
                    await bot.sendMessage(chatId, "Не найден список подтем.");
                    return;
                }
                // Используем твою generateButtons
                const buttons = questions.subthemes.map(t => [{ text: t.title, callback_data: `admin_edit_theme_${t.id}` }]);
                await bot.sendMessage(chatId, "Выберите подтему:", {
                    reply_markup: { inline_keyboard: buttons }
                });
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Выбор подтемы для редактирования видео ---
            if (cbq.data.startsWith("admin_edit_theme_")) {
                const themeId = cbq.data.replace("admin_edit_theme_", "");
                state = { ...state, themeId, mode: "edit_video_choose_theme_or_leaf" };
                adminStates.set(chatId, state);

                const limb = state.limb;
                const logic = logicLoader.getLogic();
                const limbTheme = logic.themes[0].subthemes.find(t => t.id === limb);
                const questions = limbTheme?.subthemes.find(t => t.id === `${limb}_questions`);
                let theme = questions?.subthemes.find(t => t.id === themeId);
                console.log("limb ", limb)
                console.log("theme ", theme)

                // Если у темы есть subthemes — показываем их для выбора
                if (theme && theme.subthemes && theme.subthemes.length > 0) {
                    const buttons = theme.subthemes.map(t => [{ text: t.title, callback_data: `admin_edit_theme_${t.id}` }]);
                    await bot.sendMessage(chatId, "Выберите более конкретную подтему:", {
                        reply_markup: { inline_keyboard: buttons }
                    });
                    await bot.answerCallbackQuery(cbq.id);
                    return;
                }

                // Если это "лист" — переход к выбору уровня ампутации
                if (theme) {
                    state = { ...state, themeId: theme.id, mode: "edit_video_choose_level" };
                    adminStates.set(chatId, state);

                    const levels = LIMBS[limb].levels;
                    const buttons = levels.map(lvl => [{ text: lvl.title, callback_data: `admin_edit_level_${lvl.id}` }]);
                    await bot.sendMessage(chatId, "Выберите уровень ампутации:", {
                        reply_markup: { inline_keyboard: buttons }
                    });
                    await bot.answerCallbackQuery(cbq.id);
                    return;
                }

                // Если не нашли тему
                await bot.sendMessage(chatId, "Ошибка: подтема не найдена.");
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Ввод/замена видео для выбранной "листовой" темы и уровня ---
            if (cbq.data.startsWith("admin_edit_level_")) {
                const levelId = cbq.data.replace("admin_edit_level_", "");
                state = { ...state, levelId, mode: "edit_video_enter_url" };
                adminStates.set(chatId, state);

                // Найти "листовую" подтему
                const logic = logicLoader.getLogic();
                const limb = state.limb;
                const limbTheme = logic.themes[0].subthemes.find(t => t.id === limb);
                const questions = limbTheme?.subthemes.find(t => t.id === `${limb}_questions`);
                // Рекурсивно ищем по id во всем дереве questionsSection
                function findLeafTheme(themes, id) {
                    for (const t of themes) {
                        if (t.id === id) return t;
                        if (t.subthemes) {
                            const found = findLeafTheme(t.subthemes, id);
                            if (found) return found;
                        }
                    }
                    return null;
                }
                const theme = findLeafTheme(questions.subthemes, state.themeId);

                const currentVideo = theme?.videos_by_level?.[levelId] || null;
                let msg = currentVideo
                    ? `Текущее видео: ${currentVideo}\n\nВведите новую ссылку или "-" чтобы оставить без изменений:`
                    : "Видео для этого уровня еще не добавлено. Введите ссылку или '-' чтобы пропустить:";
                await bot.sendMessage(chatId, msg);
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Создание новой подтемы ---
            if (cbq.data === "admin_new_subtheme") {
                state = { mode: "enter_new_subtheme_title", subtheme: {}, videos: {}, videoIdx: 0 };
                adminStates.set(chatId, state);
                await bot.sendMessage(chatId, "Введите название новой подтемы:");
                await bot.answerCallbackQuery(cbq.id);
                return;
            }

            // --- Пропуск видео при создании новой подтемы ---
            if (cbq.data.startsWith("admin_skip_video_")) {
                const idx = parseInt(cbq.data.replace("admin_skip_video_", ""), 10);
                state = adminStates.get(chatId);
                state.videos[getLimbLevelKeyByIdx(idx)] = "";
                await askNextVideo(bot, chatId, state, idx + 1);
                adminStates.set(chatId, state);
                await bot.answerCallbackQuery(cbq.id);
                return;
            }
        });

        // --- Сообщения (текст) ---
        bot.on("message", async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(msg.from.username)) return;
            let state = adminStates.get(chatId);
            if (!state) return;

            // --- Ввод ссылки для редактирования видео ---
            if (state.mode === "edit_video_enter_url") {
                const logic = logicLoader.getLogic();
                const limb = state.limb;
                const themeId = state.themeId;
                const levelId = state.levelId;

                // Найти "листовую" подтему
                const limbTheme = logic.themes[0].subthemes.find(t => t.id === limb);
                const questionsSection = limbTheme?.subthemes.find(t => t.id === `${limb}_questions`);
                function findLeafTheme(themes, id) {
                    for (const t of themes) {
                        if (t.id === id) return t;
                        if (t.subthemes) {
                            const found = findLeafTheme(t.subthemes, id);
                            if (found) return found;
                        }
                    }
                    return null;
                }
                const theme = findLeafTheme(questionsSection.subthemes, themeId);
                console.log("!!theme ", theme)

                if (!theme) {
                    await bot.sendMessage(chatId, "Ошибка: подтема не найдена.");
                    adminStates.set(chatId, { mode: "main_menu" });
                    return;
                }
                if (!theme.videos_by_level) theme.videos_by_level = {};

                if (msg.text === "-") {
                    await bot.sendMessage(chatId, "Изменения отменены, видео осталось прежним.");
                } else {
                    theme.videos_by_level[levelId] = msg.text;
                    fs.writeFileSync(logicLoader.filePath, JSON.stringify(logic, null, 2), "utf-8");
                    await bot.sendMessage(chatId, "Видео обновлено!");
                }
                adminStates.set(chatId, { mode: "main_menu" });
                return;
            }

            // --- Ввод названия новой подтемы ---
            if (state.mode === "enter_new_subtheme_title") {
                state.subtheme.title = msg.text;
                state.mode = "add_video_loop";
                state.videoIdx = 0;
                adminStates.set(chatId, state);
                await askNextVideo(bot, chatId, state, 0);
                return;
            }

            // --- Ввод ссылки на видео для нового уровня ---
            if (state.mode === "add_video_loop") {
                const idx = state.videoIdx || 0;
                state.videos[getLimbLevelKeyByIdx(idx)] = msg.text === "-" ? "" : msg.text;
                await askNextVideo(bot, chatId, state, idx + 1);
                return;
            }
        });

        // --- Вспомогательные функции ---
        async function askNextVideo(bot, chatId, state, idx) {
            const allLevels = getAllLimbLevels();
            if (idx >= allLevels.length) {
                // --- Сохраняем подтему ---
                const logic = logicLoader.getLogic();
                // Добавляем в "Выберите интересующий Вас вопрос" для ног (или рук)
                // Для простоты — всегда в ноги, доработай под руки если нужно
                const legs = logic.themes[0].subthemes.find(t => t.id === "legs");
                const questionsSection = legs.subthemes.find(t => t.id === "legs_questions");
                if (!questionsSection) {
                    await bot.sendMessage(chatId, "Ошибка: не найден раздел вопросов.");
                    adminStates.set(chatId, { mode: "main_menu" });
                    return;
                }
                // Формируем videos_by_level
                const videos_by_level = {};
                for (const key in state.videos) {
                    if (state.videos[key]) videos_by_level[key] = state.videos[key];
                }
                const newSubtheme = {
                    id: `custom_${Date.now()}`,
                    title: state.subtheme.title,
                    level: 4,
                    videos_by_level
                };
                if (!questionsSection.subthemes) questionsSection.subthemes = [];
                questionsSection.subthemes.push(newSubtheme);
                fs.writeFileSync(logicLoader.filePath, JSON.stringify(logic, null, 2), "utf-8");
                await bot.sendMessage(chatId, `Подтема "${state.subtheme.title}" успешно добавлена!`);
                adminStates.set(chatId, { mode: "main_menu" });
            } else {
                const { limb, level, title } = getLimbLevelByIdx(idx);
                state.mode = "add_video_loop";
                state.videoIdx = idx;
                adminStates.set(chatId, state);
                await bot.sendMessage(chatId,
                    `Добавить видео для "${LIMBS[limb].name}" — "${title}"?\nОтправьте ссылку или "-" чтобы пропустить.`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "Пропустить", callback_data: `admin_skip_video_${idx}` }]
                            ]
                        }
                    }
                );
            }
        }
    }*/
