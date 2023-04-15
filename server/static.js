const fill = (x) => {
  x = x.toString();
  return x.length > 1 ? x : '0' + x;
}

exports.briefFormat = (now) => {
  return now.getFullYear() + '-' + fill(now.getMonth() + 1) + '-' + fill(now.getDate());
}

exports.Format = (now) => {
  return now.getFullYear() + '-' + fill(now.getMonth() + 1) + '-' + fill(now.getDate()) + ' ' + fill(now.getHours()) + ':' + fill(now.getMinutes()) + ':' + fill(now.getSeconds());
}