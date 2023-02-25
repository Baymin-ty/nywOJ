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