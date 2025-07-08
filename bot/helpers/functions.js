import {ADMIN_USERNAMES, LIMBS} from './consts.js'
import {adminStates} from "./stateController.js";
import fs from "fs";

// --- Вспомогательные функции ---

export function isAdmin(userName) {
  if (!userName) return false;
  return ADMIN_USERNAMES.includes(userName);
}

export function generateAddSubthemeButtons(subthemes, prefix = "") {
  if (!subthemes || !Array.isArray(subthemes)) return [];

  const buttons = [];
  subthemes.forEach(theme => {
    buttons.push([{
      text: prefix + theme.title,
      callback_data: `admin_add_subtheme_to_${theme.id}`
    }]);

    if (theme.subthemes && theme.subthemes.length > 0) {
      buttons.push(...generateAddSubthemeButtons(theme.subthemes, prefix + "  "));
    }
  });

  return buttons;
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

/*// Рекурсивный поиск темы по ID
export function findThemeById(themes, id) {
  if (!themes || !Array.isArray(themes)) return null;

  for (const theme of themes) {
    if (theme.id === id) return theme;
    if (theme.subthemes && theme.subthemes.length > 0) {
      const found = findThemeById(theme.subthemes, id);
      if (found) return found;
    }
  }
  return null;
}*/

// --- Рекурсивная генерация кнопок для выбора подтемы ---
// helpers/functions.js - добавить/обновить функции

export function generateSubthemeButtons(subthemes) {
  if (!subthemes || !Array.isArray(subthemes)) return [];
  return subthemes.map(theme => [{
    text: theme.title,
    callback_data: `admin_edit_theme_${theme.id}`
  }]);
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