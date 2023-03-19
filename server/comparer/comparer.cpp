/*
 * It is the comparer for nywOJ
 * author: ty
 */

#include "testlib.h"

#define SHOW_DIFF_LENGTH 40

int line, difcol, l, r1, r2;
bool ok = true;
std::string Std, usr, Exp, found;

int main(int argc, char *argv[])
{
  registerTestlibCmd(argc, argv);

  while (!ans.eof() && ok)
  {
    ++line;
    Std = ans.readLine();
    usr = ouf.readLine();

    while (usr.length() &&
           (usr.back() == ' ' ||
            usr.back() == '\n' ||
            usr.back() == '\r'))
      usr.pop_back();

    while (Std.length() &&
           (Std.back() == ' ' ||
            Std.back() == '\n' ||
            Std.back() == '\r'))
      Std.pop_back();

    if (Std == usr)
      continue;
    ok = false;
    for (int i = 0; i < usr.length(); i++)
    {
      if (Std[i] == usr[i])
        continue;
      difcol = i;
      break;
    }
  }

  if (ok)
    quitf(_ok, "total line: %d", line);

  l = difcol - SHOW_DIFF_LENGTH;

  r1 = r2 = difcol + SHOW_DIFF_LENGTH;

  if (l < 0)
    l = 0;
  if (r1 > usr.length())
    r1 = usr.length();
  if (r2 > Std.length())
    r2 = Std.length();

  found = usr.substr(l, r1 - l + 1);
  Exp = Std.substr(l, r2 - l + 1);

  if (l > 0)
  {
    Exp = "......" + Exp;
    found = "......" + found;
  }

  if (r1 + 1 < usr.length())
    found += "......";
  if (r2 + 1 < Std.length())
    Exp += "......";

  quitf(_wa, "diff on line %d, column %d\nexpected \'%s\'\n   found \'%s\'\n", line, difcol + 1, Exp.c_str(), found.c_str());
}