export const getNameColor = (gid, cnt) => {
  if (gid !== 1)
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
  'System Error': '#607D8B'
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