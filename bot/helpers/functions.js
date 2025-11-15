import { ADMIN_USERNAMES } from './consts.js'
import { pushState, userStates, adminStates } from "./stateController.js";
import fs from "fs";

// --- Вспомогательные функции ---
export function isAdmin(userName) {
  if (!userName) return false;
  return ADMIN_USERNAMES.includes(userName);
}

export function getLimbLevelKeyByIdx(idx) {
  const levels = [
    "legs_foot", "legs_shin", "legs_thigh", "legs_hip_disarticulation",
    "arms_hand", "arms_forearm", "arms_shoulder", "arms_shoulder_disarticulation"
  ];
  return levels[idx] || null;
}

export function getLimbLevelByIdx(idx) {
  const levels = [
    { limb: "legs", level: "legs_foot", title: "Стопа" },
    { limb: "legs", level: "legs_shin", title: "Голень" },
    { limb: "legs", level: "legs_thigh", title: "Бедро" },
    { limb: "legs", level: "legs_hip_disarticulation", title: "Вычленение в тазобедренном суставе" },
    { limb: "arms", level: "arms_hand", title: "Кисть" },
    { limb: "arms", level: "arms_forearm", title: "Предплечье" },
    { limb: "arms", level: "arms_shoulder", title: "Плечо" },
    { limb: "arms", level: "arms_shoulder_disarticulation", title: "Вычленение в плечевом суставе" }
  ];
  return levels[idx] || null;
}

export function getAllLimbLevels() {
  return [
    "legs_foot", "legs_shin", "legs_thigh", "legs_hip_disarticulation",
    "arms_hand", "arms_forearm", "arms_shoulder", "arms_shoulder_disarticulation"
  ];
}

// --- Генерация кнопок ---
export function generateButtons(subthemes, includeBack = false) {
  if (!subthemes || subthemes.length === 0) {
    return [];
  }

  const buttons = subthemes.map((theme) => [
    {
      text: theme.title,
      callback_data: theme.id,
    },
  ]);

  if (includeBack) {
    /*buttons.push([
      {
        text: "⬅️ Назад",
        callback_data: "back",
      },
    ]);*/
  }

  return buttons;
}

// --- Форматирование сообщения ---
export function formatThemeMessage(theme) {
  return `*${theme.title}*\n\n`;
}

// --- Вспомогательные функции for admin panel ---
export function generateEditNavigationButtons(subthemes) {
  if (!subthemes || !Array.isArray(subthemes)) return [];
  return subthemes.map(theme => [{
    text: theme.title,
    callback_data: `admin_edit_nav_${theme.id}`
  }]);
}

export function generateAddNavigationButtons(subthemes) {
  if (!subthemes || !Array.isArray(subthemes)) return [];
  return subthemes.map(theme => [{
    text: `📁 ${theme.title}`,
    callback_data: `admin_add_nav_${theme.id}`
  }]);
}

export function generateDeleteNavigationButtons(subthemes) {
  if (!subthemes || !Array.isArray(subthemes)) return [];
  return subthemes.map(theme => [{
    text: theme.title,
    callback_data: `admin_delete_nav_${theme.id}`
  }]);
}

// Вспомогательная функция для поиска родительской темы
export function findParentTheme(themeId, themes, parent = null) {
  if (!themes || !Array.isArray(themes)) return null;

  for (const theme of themes) {
    if (theme.id === themeId) {
      return parent;
    }
    if (theme.subthemes && theme.subthemes.length > 0) {
      const found = findParentTheme(themeId, theme.subthemes, theme);
      if (found !== null) return found;
    }
  }
  return null;
}

// Вспомогательная функция для построения информации об удалении
export function buildDeleteInfo(theme, logicLoader) {
  let info = `*Тема:* ${escapeMarkdownV2(theme.title)}\n`;
  info += `*ID:* \`${escapeMarkdownV2(theme.id)}\`\n\n`;

  // Подсчитываем видео
  let videoCount = 0;
  if (theme.videos_by_level) videoCount += Object.keys(theme.videos_by_level).length;
  if (theme.files_by_level) videoCount += Object.keys(theme.files_by_level).length;
  if (videoCount > 0) {
    info += `🎬 *Видео:* ${videoCount}\n`;
  }

  // Подсчитываем подтемы (рекурсивно)
  let subthemeCount = 0;
  if (theme.subthemes && theme.subthemes.length > 0) {
    subthemeCount = countSubthemes(theme.subthemes);
    info += `📁 *Подтем:* ${subthemeCount}\n`;
  }

  return info;
}

// Рекурсивный подсчет подтем
function countSubthemes(subthemes) {
  if (!subthemes || !Array.isArray(subthemes)) return 0;
  let count = subthemes.length;
  for (const subtheme of subthemes) {
    if (subtheme.subthemes && subtheme.subthemes.length > 0) {
      count += countSubthemes(subtheme.subthemes);
    }
  }
  return count;
}

export function buildStructureText(themes, level = 0, maxDepth = 3) {
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

export async function askNextVideo(bot, chatId, state, idx, logicLoader, logicFilePath) {
  const allLevels = getAllLimbLevels();

  if (idx >= allLevels.length) {
    // Все видео добавлены, сохраняем подтему
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

export function splitLongMessage(text, maxLength = 3500) {
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

export async function saveNewSubtheme(bot, chatId, state, logicLoader, logicFilePath) {
  try {
    const logic = logicLoader.getLogic();
    if (!logic) {
      await bot.sendMessage(chatId, "❌ Ошибка загрузки логики.");
      return;
    }

    const parentTheme = logicLoader.findThemeById(state.parentId, logic.themes);

    if (!parentTheme) {
      // await bot.sendMessage(chatId, "❌ Ошибка: родительская тема не найдена.");
      // adminStates.set(chatId, { mode: "main_menu" });
      return;
    }

    const videos_by_level = {};
    const files_by_level = {};
    const description_by_level = {};

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

    if (state.descriptions) {
      Object.keys(state.descriptions).forEach(key => {
        if (state.descriptions[key] && state.descriptions[key].trim() !== "" && state.descriptions[key] !== "-") {
          description_by_level[key] = state.descriptions[key].trim();
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
    if (Object.keys(description_by_level).length > 0) {
      newSubtheme.description_by_level = description_by_level;
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
export function escapeMarkdownV2(text) {
  if (!text) return "";
  return text.replace(/[_*[\]()~`>#+=|{}.!-\\]/g, '\\$&');
}

export const navigateToAmputationLevel = async (bot, chatId, limb, logicLoader, callbackQuery = null) => {
  const theme = logicLoader.findThemeById(limb);
  if (!theme) {
    return;
  }

  const state = userStates.get(chatId) || { history: [], limb: null, amputationLevel: null };

  // Выбор конечности - оставляем проверку как было
  if (theme.id === limb) {
    state.limb = theme.id;
    state.amputationLevel = null;

    // Убедитесь, что pushState доступна в этом контексте
    if (typeof pushState !== 'undefined') {
      pushState(chatId, theme.id);
    }

    const amputationThemeId = theme.id + "_amputation_level";
    const amputationTheme = logicLoader.findThemeById(amputationThemeId);

    if (!amputationTheme) {
      await bot.sendMessage(chatId, "Ошибка: уровень ампутации не найден.");
      return;
    }

    if (typeof pushState !== 'undefined') {
      pushState(chatId, amputationTheme.id);
    }

    const buttons = generateButtons(amputationTheme.subthemes, true);
    await bot.sendMessage(chatId, formatThemeMessage(amputationTheme) + "Выберите уровень ампутации:", {
      reply_markup: {
        inline_keyboard: buttons,
      },
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });

    userStates.set(chatId, state);

    // Отвечаем на callback только если он был передан
    if (callbackQuery) {
      await bot.answerCallbackQuery(callbackQuery.id);
    }
    return;
  }
}
