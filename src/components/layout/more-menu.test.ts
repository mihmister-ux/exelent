import { describe, expect, it } from "vitest";

import { MORE_ACTIONS, moreLinks, moreTarget } from "@/components/layout/more-menu";
import { TABS } from "@/components/layout/navigation";

describe("more-menu — состав шторки «Ещё»", () => {
  it("в меню есть выгрузка в Excel и резервная копия — то, чего не хватало на телефоне", () => {
    expect(MORE_ACTIONS.map((action) => action.title)).toEqual([
      "Выгрузить в Excel",
      "Резервная копия",
    ]);
  });

  it("резервная копия ведёт на якорь #backup страницы экспорта", () => {
    const backup = MORE_ACTIONS.find((action) => action.id === "backup");
    expect(backup?.path).toBe("/export#backup");
  });

  it("хвост разделов, не влезших в док, добавляется в конец шторки", () => {
    const overflow = TABS.slice(4).map(({ id, label, path, icon }) => ({
      key: `tab-${id}`,
      id,
      title: label,
      path,
      icon,
    }));
    const links = moreLinks(overflow);
    expect(links.map((link) => link.title)).toEqual([
      "Выгрузить в Excel",
      "Резервная копия",
      "Поставщики",
    ]);
  });

  it("ключи пунктов меню и разделов не пересекаются", () => {
    const overflow = TABS.slice(4).map(({ id, label, path, icon }) => ({
      key: `tab-${id}`,
      id,
      title: label,
      path,
      icon,
    }));
    const keys = moreLinks(overflow).map((link) => link.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("moreTarget — подсветка активного пункта", () => {
  it("без якоря — выгрузка в Excel", () => {
    expect(moreTarget("")).toBe("export");
    expect(moreTarget("#/export")).toBe("export");
  });

  it("с якорем #backup — резервная копия", () => {
    expect(moreTarget("#/export#backup")).toBe("backup");
  });
});