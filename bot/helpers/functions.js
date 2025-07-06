import {ADMIN_USERNAMES, LIMBS} from './consts.js'
import {adminStates} from "./stateController.js";
import fs from "fs";

// --- Вспомогательные функции ---

export function isAdmin(userName) {
  if (!userName) return false;
  return ADMIN_USERNAMES.includes(userName);
}

export function getAllLimbLevels() {
  const arr = [];
  for (const limb in LIMBS) {
    for (const level of LIMBS[limb].levels) {
      arr.push({ limb, level: level.id, title: level.title });
    }
  }
  return arr;
}

// --- Рекурсивная генерация кнопок для добавления новой подтемы ---
export function generateAddSubthemeButtons(subthemes, prefix = "") {
  let buttons = subthemes.map(t => [
    { text: prefix + t.title, callback_data: `admin_add_subtheme_to_${t.id}` }
  ]);
  // также рекурсивно добавлять кнопки для всех вложенных
  subthemes.forEach(t => {
    if (t.subthemes && t.subthemes.length > 0) {
      buttons = buttons.concat(generateAddSubthemeButtons(t.subthemes, prefix + "— "));
    }
  });
  return buttons;
}

export function getLimbLevelByIdx(idx) {
  return getAllLimbLevels()[idx];
}

export function getLimbLevelKeyByIdx(idx) {
  const { limb, level } = getLimbLevelByIdx(idx);
  return level;
}

export async function askNextVideo(bot, chatId, state, idx) {
  const allLevels = getAllLimbLevels();
  if (idx >= allLevels.length) {
    // --- Сохраняем подтему ---
    const logic = logicLoader.getLogic();
    const limb = state.limb;
    const parentId = state.parentId;

    // Найти родительскую подтему
    const limbTheme = logic.themes[0].subthemes.find(t => t.id === limb);
    const questionsSection = limbTheme?.subthemes.find(t => t.id === `${limb}_questions`);
    let parentTheme = parentId === questionsSection.id
        ? questionsSection
        : logicLoader.findThemeById(questionsSection.subthemes, parentId);

    if (!parentTheme) {
      await bot.sendMessage(chatId, "Ошибка: родительская подтема не найдена.");
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
      level: (parentTheme.level || 3) + 1,
      videos_by_level,
      subthemes: []
    };
    if (!parentTheme.subthemes) parentTheme.subthemes = [];
    parentTheme.subthemes.push(newSubtheme);
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

// --- Рекурсивная генерация кнопок для выбора подтемы ---
export function generateSubthemeButtons(subthemes, prefix = "") {
  return subthemes.map(t => [
    { text: prefix + t.title, callback_data: `admin_edit_theme_${t.id}` }
  ]);
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
    buttons.push([
      {
        text: "⬅️ Назад",
        callback_data: "back",
      },
    ]);
  }

  return buttons;
}

// --- Форматирование сообщения ---
export function formatThemeMessage(theme) {
  let text = `*${theme.title}*\n\n`;
  // if (theme.level) text += `_Уровень вложенности: ${theme.level}_\n\n`;
  return text;
}