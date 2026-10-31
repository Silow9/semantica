import assert from "node:assert/strict";
import test from "node:test";

import { nodeTypeCatalogs, relationCatalogs } from "../src/i18n/graphTerms.ts";
import { setLocale } from "../src/i18n/index.ts";
import {
  translateNodeType,
  translateRelationType,
} from "../src/workspaces/GraphWorkspace/graphTermLabels.ts";

test("graph term labels stay canonical in English and translate in Chinese", () => {
  setLocale("en");
  assert.equal(translateRelationType("possesses"), "possesses");
  assert.equal(translateRelationType("mentions"), "mentions");
  assert.equal(translateNodeType("Person"), "Person");

  setLocale("zh");
  assert.equal(translateRelationType("possesses"), relationCatalogs.zh.possesses);
  assert.equal(translateRelationType("MENTIONS"), relationCatalogs.zh.mentions);
  assert.equal(translateRelationType("works_at"), relationCatalogs.zh.works_at);
  assert.equal(translateRelationType("located_in"), relationCatalogs.zh.located_in);
  assert.equal(translateNodeType("Person"), nodeTypeCatalogs.zh.person);
  assert.equal(translateNodeType("ORGANIZATION"), nodeTypeCatalogs.zh.organization);
  assert.equal(translateNodeType("document"), nodeTypeCatalogs.zh.document);
  assert.equal(translateRelationType("custom_link"), "custom link");

  setLocale("en");
});
