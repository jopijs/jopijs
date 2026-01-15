import {getLogger} from "jopi-toolkit/jk_logs";

export const logSsg = getLogger("jopi.ssg");
export const logSsgCrawler = getLogger("crawler", logSsg);