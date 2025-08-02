import dotenv from 'dotenv';
dotenv.config();

export const OPTIONS = {
  polling: true,
  cancellation: false
};

export const LIMBS = {
  legs: {
    name: "Ноги",
    levels: [
      { id: "legs_foot", title: "Стопа (сохранен голеностопный сустав)" },
      { id: "legs_shin", title: "Голень (сохранен коленный сустав)" },
      { id: "legs_thigh", title: "Бедро (сохранен тазобедренный сустав)" },
      { id: "legs_hip_disarticulation", title: "Вычленение в тазобедренном суставе" }
    ]
  },
  arms: {
    name: "Руки",
    levels: [
      { id: "arms_hand", title: "Кисть" },
      { id: "arms_forearm", title: "Предплечье" },
      { id: "arms_shoulder", title: "Плечо" },
      { id: "arms_shoulder_disarticulation", title: "Вычленение в плечевом суставе" }
    ]
  }
};

// Menu commands
export const DEFAULT_COMMANDS = [
  { command: '/start', description: 'Запустить бота' },
  { command: '/hand', description: 'Ампутация руки' },
  { command: '/leg', description: 'Ампутация ноги' },
];

export const ADMIN_COMMANDS = [
  { command: '/admin', description: 'Админ команды' },
];

export const ADMIN_USERNAMES = process.env.ADMINS?.split(',') || [];