import TelegramApi from "node-telegram-bot-api";
import path from "path";
import { fileURLToPath } from "url";
import LogicLoader from "./helpers/LogicLoader.js";
import { OPTIONS, DEFAULT_COMMANDS } from "./helpers/consts.js";
import {generateButtons, formatThemeMessage, navigateToAmputationLevel} from "./helpers/functions.js";
import { userStates, pushState, popState } from "./helpers/stateController.js";
import { adminPanelLogic } from "./logic/adminPanel.js";
import fs from "fs";

// CONFIGURE .ENV FILE
import dotenv from 'dotenv';
dotenv.config();

// CONFIGURE BOT LOGIC STATE
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logicFilePath = path.join(__dirname, "logic.json");
const logicLoader = new LogicLoader(logicFilePath);
global.logicLoader = logicLoader;

const bot = new TelegramApi(process.env.TOKEN, OPTIONS);

bot.setMyCommands(DEFAULT_COMMANDS, { scope: { type: 'default' } })
    .then(() => console.log('Общие команды установлены'))
    .catch(err => console.error('Ошибка:', err));

bot.onText(/\/hand/, async (msg) =>
  // const chatId = msg.chat.id;
  await navigateToAmputationLevel(bot, msg.chat.id, "arms", logicLoader)
);

bot.onText(/\/leg/, async (msg) =>
  // const chatId = msg.chat.id;
  await navigateToAmputationLevel(bot, msg.chat.id, "legs", logicLoader)
);

// --- Admin logic ---
adminPanelLogic(bot, logicLoader, logicFilePath);

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  const logic = logicLoader.getLogic();
  if (!logic) {
    await bot.sendMessage(chatId, "Извините, логика бота недоступна. Попробуйте позже.");
    return;
  }

  const rootTheme = logic.themes.find((t) => t.id === "t1");
  if (!rootTheme) {
    await bot.sendMessage(chatId, "Ошибка в логике бота: корневая тема не найдена.");
    return;
  }

  userStates.set(chatId, { history: [rootTheme.id], limb: null, amputationLevel: null });

  const photo = fs.createReadStream(path.join(__dirname, 'images', 'welcome.png'))
  const caption = `*Вас приветствует информационный бот *[scoliologic.ru](https://scoliologic.ru)*.*`;
  const buttons = generateButtons(rootTheme.subthemes);

  await bot.sendPhoto(chatId, photo, {
    caption: caption,
    parse_mode: 'Markdown'  // Включает форматирование (Markdown или 'HTML' для альтернативы)
  })
  .catch(err => console.error('Ошибка отправки фото:', err));

  await bot.sendMessage(chatId, formatThemeMessage(rootTheme) + "Выберите конечность:", {
    reply_markup: {
      inline_keyboard: buttons,
    },
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
});

// --- Обработка callback_query ---
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  const logic = logicLoader.getLogic();
  if (!logic) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: "Логика бота недоступна." });
    return;
  }

  if (data === "back") {
    const prevId = popState(chatId);
    if (!prevId) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "Вы уже в главном меню." });
      return;
    }
    const prevTheme = logicLoader.findThemeById(prevId);
    if (!prevTheme) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "Ошибка навигации." });
      return;
    }
    const state = userStates.get(chatId);
    if (state.history.length === 1) {
      state.limb = null;
      state.amputationLevel = null;
    } else if (prevTheme.id === "legs" || prevTheme.id === "arms") {
      state.limb = prevTheme.id;
      state.amputationLevel = null;
    } else if (prevTheme.id === "legs_amputation_level" || prevTheme.id === "arms_amputation_level") {
      state.amputationLevel = null;
    }
    userStates.set(chatId, state);

    const buttons = generateButtons(prevTheme.subthemes, prevTheme.id !== "t1");
    await bot.sendMessage(chatId, formatThemeMessage(prevTheme) + "Выберите тему:", {
      reply_markup: {
        inline_keyboard: buttons,
      },
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  const theme = logicLoader.findThemeById(data);
  if (!theme) {
    // await bot.answerCallbackQuery(callbackQuery.id, { text: "Тема не найдена." });
    return;
  }

  const state = userStates.get(chatId) || { history: [], limb: null, amputationLevel: null };

  // Выбор конечности
/*
  if (theme.id === "legs" || theme.id === "arms") {
    state.limb = theme.id;
    state.amputationLevel = null;
    pushState(chatId, theme.id);

    const amputationThemeId = theme.id + "_amputation_level";
    const amputationTheme = logicLoader.findThemeById(amputationThemeId);
    if (!amputationTheme) {
      await bot.sendMessage(chatId, "Ошибка: уровень ампутации не найден.");
      return;
    }
    pushState(chatId, amputationTheme.id);

    const buttons = generateButtons(amputationTheme.subthemes, true);
    await bot.sendMessage(chatId, formatThemeMessage(amputationTheme) + "Выберите уровень ампутации:", {
      reply_markup: {
        inline_keyboard: buttons,
      },
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });

    userStates.set(chatId, state);
    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }
*/

  if (theme.id === "legs" || theme.id === "arms") {
    await navigateToAmputationLevel(bot, chatId, theme.id, logicLoader, callbackQuery);
    return;
  }

  // Выбор уровня ампутации
  const amputationIds = new Set([
    "legs_foot",
    "legs_shin",
    "legs_thigh",
    "legs_hip_disarticulation",
    "arms_hand",
    "arms_forearm",
    "arms_shoulder",
    "arms_shoulder_disarticulation"
  ]);

  if (amputationIds.has(theme.id)) {
    state.amputationLevel = theme.id;
    pushState(chatId, theme.id);

    const questionsThemeId = state.limb + "_questions";
    const questionsTheme = logicLoader.findThemeById(questionsThemeId);
    if (!questionsTheme) {
      await bot.sendMessage(chatId, "Ошибка: вопросы не найдены.");
      return;
    }
    pushState(chatId, questionsTheme.id);

    const buttons = generateButtons(questionsTheme.subthemes, true);
    await bot.sendMessage(chatId, formatThemeMessage(questionsTheme) + "Выберите интересующий Вас вопрос:", {
      reply_markup: {
        inline_keyboard: buttons,
      },
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });

    userStates.set(chatId, state);
    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  // Выбор конкретного вопроса с видео по уровню ампутации
  if (state.limb && state.amputationLevel && (theme.videos_by_level || theme.files_by_level)) {
    pushState(chatId, theme.id);

    // Проверяем сначала загруженные файлы, потом ссылки
    let videoContent = null;
    let isFile = false;

    if (theme.files_by_level && theme.files_by_level[state.amputationLevel]) {
      videoContent = theme.files_by_level[state.amputationLevel];
      isFile = true;
    } else if (theme.videos_by_level && theme.videos_by_level[state.amputationLevel]) {
      videoContent = theme.videos_by_level[state.amputationLevel];
      isFile = false;
    }

    if (videoContent) {
      if (isFile) {
        // Отправляем загруженное видео по file_id
        await bot.sendVideo(chatId, videoContent, {
          caption: `*${theme.title}*`,
          parse_mode: "Markdown"
        });
      } else {
        // Отправляем ссылку на видео
        await bot.sendMessage(chatId, `*${theme.title}*\n\n[Смотреть видео](${videoContent})`, {
          parse_mode: "Markdown",
          disable_web_page_preview: false,
        });
      }
    } else {
      await bot.sendMessage(chatId, `Видео для выбранного уровня ампутации отсутствует.`);
    }

    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  // Если тема без видео и без специальных условий — показываем подтемы или сообщение
  pushState(chatId, theme.id);

  if (theme.subthemes && theme.subthemes.length > 0) {
    const buttons = generateButtons(theme.subthemes, theme.id !== "t1");
    await bot.sendMessage(chatId, formatThemeMessage(theme) + "Выберите подкатегорию:", {
      reply_markup: {
        inline_keyboard: buttons,
      },
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } else {
    await bot.sendMessage(chatId, `По теме "${theme.title}" нет дополнительной информации.`);
  }

  userStates.set(chatId, state);
  await bot.answerCallbackQuery(callbackQuery.id);
});

// --- Обработка ошибок ---
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});
