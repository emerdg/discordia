"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.endpointMatchesAnyFilter = endpointMatchesAnyFilter;
exports.endpointMatchesFilter = endpointMatchesFilter;
exports.getCodebasesFromConfig = getCodebasesFromConfig;
exports.parseFunctionSelector = parseFunctionSelector;
exports.getEndpointFilters = getEndpointFilters;
exports.getHumanFriendlyPlatformName = getHumanFriendlyPlatformName;
exports.getFunctionLabel = getFunctionLabel;
exports.targetCodebases = targetCodebases;
exports.groupEndpointsByCodebase = groupEndpointsByCodebase;
exports.isCodebaseFiltered = isCodebaseFiltered;
exports.isEndpointFiltered = isEndpointFiltered;
const backend = require("./backend");
const projectConfig_1 = require("../../functions/projectConfig");
const functional_1 = require("../../functional");
function endpointMatchesAnyFilter(endpoint, filters) {
    if (!filters) {
        return true;
    }
    return filters.some((filter) => endpointMatchesFilter(endpoint, filter));
}
function endpointMatchesFilter(endpoint, filter) {
    if (endpoint.codebase && filter.codebase) {
        if (endpoint.codebase !== filter.codebase) {
            return false;
        }
    }
    if (!filter.idChunks) {
        return true;
    }
    const idChunks = endpoint.id.split("-");
    if (idChunks.length < filter.idChunks.length) {
        return false;
    }
    for (let i = 0; i < filter.idChunks.length; i += 1) {
        if (idChunks[i] !== filter.idChunks[i]) {
            return false;
        }
    }
    return true;
}
function getCodebasesFromConfig(config) {
    return [
        ...new Set(config.flatMap((c) => ((0, projectConfig_1.isKitConfig)(c) ? Object.keys(c.instances) : [c.codebase]))),
    ];
}
function parseFunctionSelector(selector, config) {
    const fragments = selector.split(":");
    const target = fragments[0];
    const codebaseNames = getCodebasesFromConfig(config);
    if (codebaseNames.includes(target)) {
        return [
            {
                codebase: target,
                ...(fragments.length > 1 ? { idChunks: fragments[1].split(/[-.]/) } : {}),
            },
        ];
    }
    if (fragments.length < 2) {
        return [{ codebase: projectConfig_1.DEFAULT_CODEBASE, idChunks: fragments[0].split(/[-.]/) }];
    }
    return [
        {
            codebase: fragments[0],
            idChunks: fragments[1].split(/[-.]/),
        },
    ];
}
function getEndpointFilters(options, config) {
    if (!options.only) {
        return undefined;
    }
    const selectors = options.only.split(",");
    const filters = [];
    for (let selector of selectors) {
        if (selector.startsWith("functions:")) {
            selector = selector.replace("functions:", "");
            if (selector.length > 0) {
                filters.push(...parseFunctionSelector(selector, config));
            }
        }
    }
    if (filters.length === 0) {
        return undefined;
    }
    return filters;
}
function getHumanFriendlyPlatformName(platform) {
    if (platform === "gcfv1") {
        return "1st Gen";
    }
    else if (platform === "gcfv2") {
        return "2nd Gen";
    }
    else if (platform === "run") {
        return "Cloud Run";
    }
    (0, functional_1.assertExhaustive)(platform);
}
function getFunctionLabel(fn) {
    let id = `${fn.id}(${fn.region})`;
    if (fn.codebase && fn.codebase !== projectConfig_1.DEFAULT_CODEBASE) {
        id = `${fn.codebase}:${id}`;
    }
    return id;
}
function targetCodebases(config, filters) {
    const codebasesFromConfig = getCodebasesFromConfig(config);
    if (!filters) {
        return [...codebasesFromConfig];
    }
    const codebasesFromFilters = [
        ...new Set(filters.map((f) => f.codebase).filter((c) => c !== undefined)),
    ];
    if (codebasesFromFilters.length === 0) {
        return [...codebasesFromConfig];
    }
    return codebasesFromConfig.filter((codebase) => codebasesFromFilters.includes(codebase));
}
function groupEndpointsByCodebase(wantBackends, haveEndpoints) {
    const grouped = {};
    let endpointsToAssign = haveEndpoints;
    for (const codebase of Object.keys(wantBackends)) {
        const names = backend.allEndpoints(wantBackends[codebase]).map((e) => backend.functionName(e));
        grouped[codebase] = backend.of(...endpointsToAssign.filter((e) => names.includes(backend.functionName(e))));
        endpointsToAssign = endpointsToAssign.filter((e) => !names.includes(backend.functionName(e)));
    }
    for (const codebase of Object.keys(wantBackends)) {
        const matchedEndpoints = endpointsToAssign.filter((e) => e.codebase === codebase);
        grouped[codebase] = backend.merge(grouped[codebase], backend.of(...matchedEndpoints));
        const matchedNames = matchedEndpoints.map((e) => backend.functionName(e));
        endpointsToAssign = endpointsToAssign.filter((e) => {
            return !matchedNames.includes(backend.functionName(e));
        });
    }
    return grouped;
}
function isCodebaseFiltered(codebase, filters) {
    return filters.some((filter) => {
        const noIdChunks = (filter.idChunks || []).length === 0;
        return noIdChunks && filter.codebase === codebase;
    });
}
function isEndpointFiltered(endpoint, filters) {
    return filters.some((filter) => endpointMatchesFilter(endpoint, filter));
}
