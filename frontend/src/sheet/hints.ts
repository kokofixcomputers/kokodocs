/** Argument signatures for the most-used functions (shown while typing a formula). */
export const SIGNATURES: Record<string, string> = {
  SUM: 'SUM(value1, [value2, …])', AVERAGE: 'AVERAGE(value1, [value2, …])', COUNT: 'COUNT(value1, [value2, …])', COUNTA: 'COUNTA(value1, [value2, …])',
  MAX: 'MAX(value1, [value2, …])', MIN: 'MIN(value1, [value2, …])', ROUND: 'ROUND(number, digits)', ROUNDUP: 'ROUNDUP(number, digits)', ROUNDDOWN: 'ROUNDDOWN(number, digits)',
  ABS: 'ABS(number)', SQRT: 'SQRT(number)', POWER: 'POWER(number, power)', MOD: 'MOD(number, divisor)', INT: 'INT(number)', PRODUCT: 'PRODUCT(value1, [value2, …])',
  IF: 'IF(condition, value_if_true, [value_if_false])', IFS: 'IFS(condition1, value1, [condition2, value2, …])', IFERROR: 'IFERROR(value, value_if_error)', IFNA: 'IFNA(value, value_if_na)',
  SWITCH: 'SWITCH(expression, case1, value1, [case2, value2, …], [default])', CHOOSE: 'CHOOSE(index, choice1, [choice2, …])', AND: 'AND(logical1, [logical2, …])', OR: 'OR(logical1, [logical2, …])', NOT: 'NOT(logical)',
  SUMIF: 'SUMIF(range, criteria, [sum_range])', SUMIFS: 'SUMIFS(sum_range, criteria_range1, criteria1, …)', COUNTIF: 'COUNTIF(range, criteria)', COUNTIFS: 'COUNTIFS(criteria_range1, criteria1, …)',
  AVERAGEIF: 'AVERAGEIF(range, criteria, [average_range])', AVERAGEIFS: 'AVERAGEIFS(average_range, criteria_range1, criteria1, …)', MAXIFS: 'MAXIFS(max_range, criteria_range1, criteria1, …)', MINIFS: 'MINIFS(min_range, criteria_range1, criteria1, …)',
  VLOOKUP: 'VLOOKUP(search_key, range, index, [is_sorted])', HLOOKUP: 'HLOOKUP(search_key, range, index, [is_sorted])', XLOOKUP: 'XLOOKUP(search_key, lookup_range, result_range, [if_not_found], [match_mode], [search_mode])',
  INDEX: 'INDEX(reference, row, [column])', MATCH: 'MATCH(search_key, range, [match_type])', LOOKUP: 'LOOKUP(search_key, search_range, [result_range])', OFFSET: 'OFFSET(reference, rows, cols, [height], [width])', INDIRECT: 'INDIRECT(ref_text)',
  FILTER: 'FILTER(range, condition1, [if_empty])', SORT: 'SORT(range, [sort_column], [is_ascending])', SORTBY: 'SORTBY(range, by_range, [is_ascending])', UNIQUE: 'UNIQUE(range)', SEQUENCE: 'SEQUENCE(rows, [columns], [start], [step])', TRANSPOSE: 'TRANSPOSE(range)',
  SUMPRODUCT: 'SUMPRODUCT(array1, [array2, …])', LET: 'LET(name1, value1, [name2, value2, …], expression)', ROW: 'ROW([reference])', COLUMN: 'COLUMN([reference])', ROWS: 'ROWS(range)', COLUMNS: 'COLUMNS(range)',
  LEN: 'LEN(text)', LEFT: 'LEFT(text, [count])', RIGHT: 'RIGHT(text, [count])', MID: 'MID(text, start, count)', UPPER: 'UPPER(text)', LOWER: 'LOWER(text)', PROPER: 'PROPER(text)', TRIM: 'TRIM(text)',
  CONCAT: 'CONCAT(value1, [value2, …])', CONCATENATE: 'CONCATENATE(string1, [string2, …])', TEXTJOIN: 'TEXTJOIN(delimiter, ignore_empty, text1, [text2, …])', TEXTSPLIT: 'TEXTSPLIT(text, col_delimiter, [row_delimiter])',
  SUBSTITUTE: 'SUBSTITUTE(text, search, replace, [occurrence])', REPLACE: 'REPLACE(text, start, count, new_text)', FIND: 'FIND(search, text, [start])', SEARCH: 'SEARCH(search, text, [start])', TEXT: 'TEXT(number, format)', VALUE: 'VALUE(text)', REPT: 'REPT(text, times)',
  TODAY: 'TODAY()', NOW: 'NOW()', DATE: 'DATE(year, month, day)', YEAR: 'YEAR(date)', MONTH: 'MONTH(date)', DAY: 'DAY(date)', WEEKDAY: 'WEEKDAY(date, [type])', EDATE: 'EDATE(start_date, months)', EOMONTH: 'EOMONTH(start_date, months)',
  DATEDIF: 'DATEDIF(start_date, end_date, unit)', NETWORKDAYS: 'NETWORKDAYS(start_date, end_date, [holidays])', DAYS: 'DAYS(end_date, start_date)',
  PMT: 'PMT(rate, periods, present_value, [future_value], [type])', FV: 'FV(rate, periods, payment, [present_value], [type])', PV: 'PV(rate, periods, payment, [future_value], [type])', NPV: 'NPV(rate, value1, [value2, …])', IRR: 'IRR(values, [guess])',
  MEDIAN: 'MEDIAN(value1, [value2, …])', STDEV: 'STDEV(value1, [value2, …])', VAR: 'VAR(value1, [value2, …])', LARGE: 'LARGE(data, n)', SMALL: 'SMALL(data, n)', RANK: 'RANK(value, data, [is_ascending])', PERCENTILE: 'PERCENTILE(data, percentile)',
  ISBLANK: 'ISBLANK(value)', ISNUMBER: 'ISNUMBER(value)', ISTEXT: 'ISTEXT(value)', ISERROR: 'ISERROR(value)', RAND: 'RAND()', RANDBETWEEN: 'RANDBETWEEN(low, high)', CEILING: 'CEILING(number, [significance])', FLOOR: 'FLOOR(number, [significance])',
}

/** Find the function call enclosing the caret and which argument the caret is in. */
export function callAt(text: string, caret: number): { name: string; arg: number } | null {
  let depth = 0, arg = 0, inStr = false
  const stack: { start: number; arg: number }[] = []
  for (let i = 0; i < caret; i++) {
    const ch = text[i]
    if (ch === '"') inStr = !inStr
    if (inStr) continue
    if (ch === '(') { stack.push({ start: i, arg }); depth++; arg = 0 }
    else if (ch === ')') { const t = stack.pop(); depth--; arg = t ? t.arg : 0 }
    else if ((ch === ',' || ch === ';') && depth > 0) arg++
  }
  const top = stack[stack.length - 1]
  if (!top) return null
  const m = /([A-Za-z][A-Za-z0-9.]*)\s*$/.exec(text.slice(0, top.start))
  return m ? { name: m[1].toUpperCase(), arg } : null
}
