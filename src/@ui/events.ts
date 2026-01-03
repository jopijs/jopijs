import * as jk_events from "jopi-toolkit/jk_events";

export function setEventsThisValue(thisValue: any) {
    jk_events.setStaticEventsThisValue(thisValue);
}