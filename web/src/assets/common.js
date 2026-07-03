// Staff (any moderator+ role) get a distinct purple. The server attaches an
// `isStaff` flag on rabbit/leaderboard rows derived from the role table.
export const getNameColor = (isStaff, cnt) => {
  if (isStaff)
    return "#8e44ad";
  else if (cnt < 1000)
    return "#606266";
  else if (cnt < 10000)
    return "#00BFFF";
  else if (cnt < 50000)
    return "#00FF00";
  else if (cnt < 200000)
    return "#FF8C00";
  else
    return "#FF0000";
}

export const resColor = {
  'Waiting': '#2b85e4',
  'Pending': '#2b85e4',
  'Rejudging': '#2b85e4',
  'Compilation Error': '#9C27B0',
  'Accepted': '#19be6b',
  'Wrong Answer': '#E91E63',
  'Time Limit Exceeded': '#ff9900',
  'Memory Limit Exceeded': '#795548',
  'Runtime Error': '#ed4014',
  'Segmentation Fault': '#607D8B',
  'Output Limit Exceeded': '#880e4f',
  'Dangerous System Call': '#607D8B',
  'System Error': '#607D8B',
  'Canceled': '#606266',
  'Skipped': '#606266',
  'Partially Correct': '#0c8043',
  'Judgement Failed': '#8d6e63'
};

export const scoreColor = [
  '#ff4f4f',
  '#ff694f',
  '#f8603a',
  '#fc8354',
  '#fa9231',
  '#f7bb3b',
  '#ecdb44',
  '#e2ec52',
  '#b0d628',
  '#93b127',
  '#25ad40',
]

export const ratingTiers = [
  { min: 2400, label: '传奇', color: '#d0021b', bg: '#fff1f0' },
  { min: 2100, label: 'NOI', color: '#722ed1', bg: '#f9f0ff' },
  { min: 1900, label: '省选', color: '#2f54eb', bg: '#f0f5ff' },
  { min: 1700, label: '提高', color: '#08979c', bg: '#e6fffb' },
  { min: 1500, label: '普及', color: '#d48806', bg: '#fff7e6' },
  { min: 1200, label: '入门', color: '#389e0d', bg: '#f6ffed' },
  { min: 1, label: '新手', color: '#606266', bg: '#f5f7fa' },
  { min: 0, label: '未评级', color: '#909399', bg: '#f5f7fa' },
];

export const getRatingTier = (rating) => {
  const value = Number(rating || 0);
  return ratingTiers.find((tier) => value >= tier.min) || ratingTiers[ratingTiers.length - 1];
};

export const userProfilePath = (username) =>
  `/u/${encodeURIComponent(String(username || ''))}`;

import axios from "axios";
import store from '@/sto/store';

const defaultServerPreference = { misc: { sortUserByRating: false } };

const applyServerPreference = (preference) => {
  store.state.serverPreference = {
    ...defaultServerPreference,
    ...(preference || {}),
    misc: {
      ...defaultServerPreference.misc,
      ...((preference && preference.misc) || {}),
    },
  };
};

export const refreshUserInfo = async () => {
  try {
    const res = await axios.post('/api/user/getUserInfo');
    if (res.status === 200) {
      store.state.uid = res.data.uid;
      store.state.name = res.data.name;
      store.state.ip = res.data.ip;
      store.state.avatar = res.data.avatar;
      applyServerPreference(res.data.serverPreference);
      store.commit('setPermissions', res.data.permissions || []);
      store.commit('setIsRoot', !!res.data.isRoot);
    }
  } catch (_) {
    store.state.uid = 0;
    try {
      const res = await axios.get('/api/auth/getSessionInfo');
      applyServerPreference(res.data && res.data.serverPreference);
    } catch (_) {
      applyServerPreference(defaultServerPreference);
    }
    store.commit('setPermissions', []);
    store.commit('setIsRoot', false);
  }
}
