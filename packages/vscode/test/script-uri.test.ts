import { describe, expect, it } from "vitest";
import {
	addressKey,
	formatScriptPath,
	parseScriptPath,
	sameContainer,
	type ScriptAddress,
} from "../src/script-uri.js";

const commonEvent: ScriptAddress = {
	projectKey: "Game",
	container: { kind: "commonEvent", commonEventId: 3 },
};
const mapEvent: ScriptAddress = {
	projectKey: "Game",
	container: { kind: "mapEvent", mapId: 12, eventId: 4 },
};
const troop: ScriptAddress = { projectKey: "Game", container: { kind: "troop", troopId: 7 } };

describe("formatScriptPath", () => {
	it("names the container by id and ends with its name", () => {
		expect(formatScriptPath(commonEvent, "Rain sounds")).toBe(
			"/Game/common-events/3/Rain sounds.mvscript",
		);
		expect(formatScriptPath(mapEvent, "Old gate")).toBe("/Game/maps/12/events/4/Old gate.mvscript");
		expect(formatScriptPath(troop, "Cave bats")).toBe("/Game/troops/7/Cave bats.mvscript");
	});

	it("keeps a project key's segments", () => {
		expect(formatScriptPath({ ...troop, projectKey: "Games/Fear/www" }, "Bats")).toBe(
			"/Games/Fear/www/troops/7/Bats.mvscript",
		);
	});

	it("replaces separators and control characters in names", () => {
		expect(formatScriptPath(commonEvent, "On/off\\switch\ttoggle")).toBe(
			"/Game/common-events/3/On_off_switch_toggle.mvscript",
		);
	});

	it("describes containers with blank names", () => {
		expect(formatScriptPath(commonEvent, "")).toBe("/Game/common-events/3/Common event 3.mvscript");
		expect(formatScriptPath(mapEvent, "  ")).toBe("/Game/maps/12/events/4/Event 4.mvscript");
		expect(formatScriptPath(troop, "")).toBe("/Game/troops/7/Troop 7.mvscript");
	});
});

describe("parseScriptPath", () => {
	it("reads back every kind of container", () => {
		for (const address of [commonEvent, mapEvent, troop]) {
			expect(parseScriptPath(formatScriptPath(address, "Name"))).toEqual(address);
		}
	});

	it("ignores the title, so renamed containers still resolve", () => {
		expect(parseScriptPath("/Game/maps/12/events/4/Renamed.mvscript")).toEqual(mapEvent);
		expect(parseScriptPath("/Game/troops/7/")).toEqual(troop);
	});

	it("reads project keys with several segments, whatever they contain", () => {
		expect(parseScriptPath("/a/maps/1/events/common-events/3/x.mvscript")).toEqual({
			projectKey: "a/maps/1/events",
			container: { kind: "commonEvent", commonEventId: 3 },
		});
		expect(parseScriptPath("/troops/9/maps/12/events/4/x.mvscript")).toEqual({
			projectKey: "troops/9",
			container: mapEvent.container,
		});
	});

	it("rejects other paths", () => {
		for (const path of [
			"",
			"/",
			"Game/common-events/3/x.mvscript", // not absolute
			"/common-events/3/x.mvscript", // no project
			"//common-events/3/x.mvscript",
			"/Game/common-events/0/x.mvscript", // ids start at 1
			"/Game/common-events/03/x.mvscript",
			"/Game/common-events/3.5/x.mvscript",
			"/Game/common-events/-3/x.mvscript",
			"/Game/common-events/3",
			"/Game/maps/12/events/x.mvscript",
			"/Game/maps/12/pages/4/x.mvscript",
			"/Game/items/3/x.mvscript",
		]) {
			expect(parseScriptPath(path), path).toBeUndefined();
		}
	});
});

describe("addressKey and sameContainer", () => {
	it("tell containers apart by kind and id", () => {
		expect(addressKey(mapEvent)).toBe("Game/maps/12/events/4");
		expect(addressKey({ ...mapEvent, projectKey: "Other" })).not.toBe(addressKey(mapEvent));
		expect(sameContainer(commonEvent.container, { kind: "commonEvent", commonEventId: 3 })).toBe(
			true,
		);
		expect(sameContainer(commonEvent.container, { kind: "troop", troopId: 3 })).toBe(false);
		expect(sameContainer(mapEvent.container, { kind: "mapEvent", mapId: 12, eventId: 5 })).toBe(
			false,
		);
	});
});
