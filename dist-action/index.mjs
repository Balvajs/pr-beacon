import { readFileSync } from "node:fs";
import process$1 from "node:process";
import { getInput, info, setFailed } from "@actions/core";
import { z } from "zod";
import { context } from "@actions/github";
import { marked } from "marked";
import { diff, unique } from "radashi";
import picocolors from "picocolors";

//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

//#endregion
//#region src/sdk/beacon-markdown.ts
const markdownStartTag = (id) => `<!--markdown-${id}-->`;
const markdownEndTag = (id) => `<!--markdown-${id}-end-->`;
const markdownSectionRegexp = (id) => new RegExp(`${markdownStartTag(id)}[\\S\\s]*?${markdownEndTag(id)}`, "gm");
const removeMarkdownsThatShouldBeUpdated = ({ oldBeacon, contentIdsToUpdate, newMarkdowns }) => {
	let newBeacon = oldBeacon;
	const markdownIdsToRemove = diff(contentIdsToUpdate, newMarkdowns.map(({ id }) => id));
	for (const markdownIdToRemove of markdownIdsToRemove) newBeacon = newBeacon.replaceAll(markdownSectionRegexp(markdownIdToRemove), "");
	return newBeacon;
};
/**
* Go through all markdowns and update all of them with data from `newMarkdowns`
*/
const updateMarkdowns = ({ oldBeacon, contentIdsToUpdate, newMarkdowns }) => {
	let newBeacon = oldBeacon;
	newBeacon = removeMarkdownsThatShouldBeUpdated({
		contentIdsToUpdate,
		newMarkdowns,
		oldBeacon
	});
	for (const { message, id } of newMarkdowns) {
		const newMarkdown = `${markdownStartTag(id)}\n\n${message}\n${markdownEndTag(id)}`;
		if (markdownSectionRegexp(id).test(newBeacon)) newBeacon = newBeacon.replace(markdownSectionRegexp(id), newMarkdown);
		else newBeacon += newMarkdown;
	}
	return newBeacon;
};

//#endregion
//#region src/sdk/beacon-table.ts
const tableTypes = {
	fails: {
		icon: "🚫",
		log: (message) => {
			info(picocolors.red(`${picocolors.bold("🚫 FAIL")}: ${message}\n\n`));
		},
		title: "Fails"
	},
	messages: {
		icon: "📖",
		log: (message, icon) => {
			info(`${icon ?? "📖"} ${message}\n\n`);
		},
		title: "Messages"
	},
	warnings: {
		icon: "⚠️",
		log: (message) => {
			info(picocolors.yellow(`${picocolors.bold("⚠️ WARNING")}: ${message}\n\n`));
		},
		title: "Warnings"
	}
};
const tableTypesKeys = Object.keys(tableTypes);
const tableStartTag = (sectionType) => `<!--${sectionType}-section-->`;
const tableEndTag = (sectionType) => `<!--${sectionType}-section-end-->`;
const emptyTablesTemplate = tableTypesKeys.map((tableType) => `${tableStartTag(tableType)}${tableEndTag(tableType)}`).join("");
const tableRowTemplate = ({ message: { message, id, icon }, tableType }) => `<tr${id === void 0 ? "" : ` data-id="${id}"`}><td>${icon ?? tableTypes[tableType].icon}</td><td>${message}</td></tr>`;
const createTable = ({ messages, type }) => {
	const headerRow = `<tr><th></th><th>${tableTypes[type].title}</th></tr>`;
	const messageRows = messages.map((message) => tableRowTemplate({
		message,
		tableType: type
	}));
	for (const { message, icon } of messages) tableTypes[type].log(message, icon);
	return messageRows.length > 0 ? `<table>${headerRow}${messageRows.join("")}</table>` : "";
};
const appendRowToTable = ({ comment, tableType, message }) => {
	tableTypes[tableType].log(message.message, message.icon);
	return comment.replace(`</table>${tableEndTag(tableType)}`, `${tableRowTemplate({
		message,
		tableType
	})}</table>${tableEndTag(tableType)}`);
};
const regexps = {
	table: (tableType) => new RegExp(`${tableStartTag(tableType)}[\\s\\S]*?${tableEndTag(tableType)}`, "gm"),
	tableRowWithId: (id) => new RegExp(`<tr data-id="${id}">[\\S\\s]*?</tr>`, "gm"),
	tableWithContent: (tableType) => new RegExp(`${tableStartTag(tableType)}[\\s\\S]*?<td>[\\s\\S]*?${tableEndTag(tableType)}`, "gm")
};
/**
* Remove table rows that should be updated
* based on `contentIdsToUpdate` and new IDs from `newTables`
*/
const removeTableRowsThatShouldUpdate = ({ oldBeacon, contentIdsToUpdate, newTables }) => {
	let newBeacon = oldBeacon;
	const tableContentIds = unique(tableTypesKeys.flatMap((tableType) => newTables[tableType].map(({ id }) => id).filter((id) => id !== void 0)));
	const tableIdsToRemove = unique([...contentIdsToUpdate, ...tableContentIds]);
	for (const tableIdToRemove of tableIdsToRemove) newBeacon = newBeacon.replaceAll(regexps.tableRowWithId(tableIdToRemove), "");
	return newBeacon;
};
/**
* Go through all table types and update all of them with data from `newTables`
*/
const updateTables = ({ oldBeacon, newTables, contentIdsToUpdate }) => {
	let newBeacon = oldBeacon;
	newBeacon = removeTableRowsThatShouldUpdate({
		contentIdsToUpdate,
		newTables,
		oldBeacon
	});
	for (const tableType of tableTypesKeys) if (regexps.tableWithContent(tableType).test(newBeacon)) for (const message of newTables[tableType]) newBeacon = appendRowToTable({
		comment: newBeacon,
		message,
		tableType
	});
	else {
		const newTable = `${tableStartTag(tableType)}${createTable({
			messages: newTables[tableType],
			type: tableType
		})}${tableEndTag(tableType)}`;
		newBeacon = newBeacon.replace(regexps.table(tableType), newTable);
	}
	return newBeacon;
};

//#endregion
//#region node_modules/universal-user-agent/index.js
function getUserAgent() {
	if (typeof navigator === "object" && "userAgent" in navigator) return navigator.userAgent;
	if (typeof process === "object" && process.version !== void 0) return `Node.js/${process.version.substr(1)} (${process.platform}; ${process.arch})`;
	return "<environment undetectable>";
}

//#endregion
//#region node_modules/before-after-hook/lib/register.js
function register(state, name, method, options) {
	if (typeof method !== "function") throw new Error("method for before hook must be a function");
	if (!options) options = {};
	if (Array.isArray(name)) return name.reverse().reduce((callback, name) => {
		return register.bind(null, state, name, callback, options);
	}, method)();
	return Promise.resolve().then(() => {
		if (!state.registry[name]) return method(options);
		return state.registry[name].reduce((method, registered) => {
			return registered.hook.bind(null, method, options);
		}, method)();
	});
}

//#endregion
//#region node_modules/before-after-hook/lib/add.js
function addHook(state, kind, name, hook) {
	const orig = hook;
	if (!state.registry[name]) state.registry[name] = [];
	if (kind === "before") hook = (method, options) => {
		return Promise.resolve().then(orig.bind(null, options)).then(method.bind(null, options));
	};
	if (kind === "after") hook = (method, options) => {
		let result;
		return Promise.resolve().then(method.bind(null, options)).then((result_) => {
			result = result_;
			return orig(result, options);
		}).then(() => {
			return result;
		});
	};
	if (kind === "error") hook = (method, options) => {
		return Promise.resolve().then(method.bind(null, options)).catch((error) => {
			return orig(error, options);
		});
	};
	state.registry[name].push({
		hook,
		orig
	});
}

//#endregion
//#region node_modules/before-after-hook/lib/remove.js
function removeHook(state, name, method) {
	if (!state.registry[name]) return;
	const index = state.registry[name].map((registered) => {
		return registered.orig;
	}).indexOf(method);
	if (index === -1) return;
	state.registry[name].splice(index, 1);
}

//#endregion
//#region node_modules/before-after-hook/index.js
const bind = Function.bind;
const bindable = bind.bind(bind);
function bindApi(hook, state, name) {
	const removeHookRef = bindable(removeHook, null).apply(null, name ? [state, name] : [state]);
	hook.api = { remove: removeHookRef };
	hook.remove = removeHookRef;
	[
		"before",
		"error",
		"after",
		"wrap"
	].forEach((kind) => {
		const args = name ? [
			state,
			kind,
			name
		] : [state, kind];
		hook[kind] = hook.api[kind] = bindable(addHook, null).apply(null, args);
	});
}
function Singular() {
	const singularHookName = Symbol("Singular");
	const singularHookState = { registry: {} };
	const singularHook = register.bind(null, singularHookState, singularHookName);
	bindApi(singularHook, singularHookState, singularHookName);
	return singularHook;
}
function Collection() {
	const state = { registry: {} };
	const hook = register.bind(null, state);
	bindApi(hook, state);
	return hook;
}
var before_after_hook_default = {
	Singular,
	Collection
};

//#endregion
//#region node_modules/@octokit/endpoint/dist-bundle/index.js
var userAgent = `octokit-endpoint.js/0.0.0-development ${getUserAgent()}`;
var DEFAULTS = {
	method: "GET",
	baseUrl: "https://api.github.com",
	headers: {
		accept: "application/vnd.github.v3+json",
		"user-agent": userAgent
	},
	mediaType: { format: "" }
};
function lowercaseKeys(object) {
	if (!object) return {};
	return Object.keys(object).reduce((newObj, key) => {
		newObj[key.toLowerCase()] = object[key];
		return newObj;
	}, {});
}
function isPlainObject$1(value) {
	if (typeof value !== "object" || value === null) return false;
	if (Object.prototype.toString.call(value) !== "[object Object]") return false;
	const proto = Object.getPrototypeOf(value);
	if (proto === null) return true;
	const Ctor = Object.prototype.hasOwnProperty.call(proto, "constructor") && proto.constructor;
	return typeof Ctor === "function" && Ctor instanceof Ctor && Function.prototype.call(Ctor) === Function.prototype.call(value);
}
function mergeDeep(defaults, options) {
	const result = Object.assign({}, defaults);
	Object.keys(options).forEach((key) => {
		if (isPlainObject$1(options[key])) if (!(key in defaults)) Object.assign(result, { [key]: options[key] });
		else result[key] = mergeDeep(defaults[key], options[key]);
		else Object.assign(result, { [key]: options[key] });
	});
	return result;
}
function removeUndefinedProperties(obj) {
	for (const key in obj) if (obj[key] === void 0) delete obj[key];
	return obj;
}
function merge(defaults, route, options) {
	if (typeof route === "string") {
		let [method, url] = route.split(" ");
		options = Object.assign(url ? {
			method,
			url
		} : { url: method }, options);
	} else options = Object.assign({}, route);
	options.headers = lowercaseKeys(options.headers);
	removeUndefinedProperties(options);
	removeUndefinedProperties(options.headers);
	const mergedOptions = mergeDeep(defaults || {}, options);
	if (options.url === "/graphql") {
		if (defaults && defaults.mediaType.previews?.length) mergedOptions.mediaType.previews = defaults.mediaType.previews.filter((preview) => !mergedOptions.mediaType.previews.includes(preview)).concat(mergedOptions.mediaType.previews);
		mergedOptions.mediaType.previews = (mergedOptions.mediaType.previews || []).map((preview) => preview.replace(/-preview/, ""));
	}
	return mergedOptions;
}
function addQueryParameters(url, parameters) {
	const separator = /\?/.test(url) ? "&" : "?";
	const names = Object.keys(parameters);
	if (names.length === 0) return url;
	return url + separator + names.map((name) => {
		if (name === "q") return "q=" + parameters.q.split("+").map(encodeURIComponent).join("+");
		return `${name}=${encodeURIComponent(parameters[name])}`;
	}).join("&");
}
var urlVariableRegex = /\{[^{}}]+\}/g;
function removeNonChars(variableName) {
	return variableName.replace(/(?:^\W+)|(?:(?<!\W)\W+$)/g, "").split(/,/);
}
function extractUrlVariableNames(url) {
	const matches = url.match(urlVariableRegex);
	if (!matches) return [];
	return matches.map(removeNonChars).reduce((a, b) => a.concat(b), []);
}
function omit(object, keysToOmit) {
	const result = { __proto__: null };
	for (const key of Object.keys(object)) if (keysToOmit.indexOf(key) === -1) result[key] = object[key];
	return result;
}
function encodeReserved(str) {
	return str.split(/(%[0-9A-Fa-f]{2})/g).map(function(part) {
		if (!/%[0-9A-Fa-f]/.test(part)) part = encodeURI(part).replace(/%5B/g, "[").replace(/%5D/g, "]");
		return part;
	}).join("");
}
function encodeUnreserved(str) {
	return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
		return "%" + c.charCodeAt(0).toString(16).toUpperCase();
	});
}
function encodeValue(operator, value, key) {
	value = operator === "+" || operator === "#" ? encodeReserved(value) : encodeUnreserved(value);
	if (key) return encodeUnreserved(key) + "=" + value;
	else return value;
}
function isDefined(value) {
	return value !== void 0 && value !== null;
}
function isKeyOperator(operator) {
	return operator === ";" || operator === "&" || operator === "?";
}
function getValues(context, operator, key, modifier) {
	var value = context[key], result = [];
	if (isDefined(value) && value !== "") if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
		value = value.toString();
		if (modifier && modifier !== "*") value = value.substring(0, parseInt(modifier, 10));
		result.push(encodeValue(operator, value, isKeyOperator(operator) ? key : ""));
	} else if (modifier === "*") if (Array.isArray(value)) value.filter(isDefined).forEach(function(value2) {
		result.push(encodeValue(operator, value2, isKeyOperator(operator) ? key : ""));
	});
	else Object.keys(value).forEach(function(k) {
		if (isDefined(value[k])) result.push(encodeValue(operator, value[k], k));
	});
	else {
		const tmp = [];
		if (Array.isArray(value)) value.filter(isDefined).forEach(function(value2) {
			tmp.push(encodeValue(operator, value2));
		});
		else Object.keys(value).forEach(function(k) {
			if (isDefined(value[k])) {
				tmp.push(encodeUnreserved(k));
				tmp.push(encodeValue(operator, value[k].toString()));
			}
		});
		if (isKeyOperator(operator)) result.push(encodeUnreserved(key) + "=" + tmp.join(","));
		else if (tmp.length !== 0) result.push(tmp.join(","));
	}
	else if (operator === ";") {
		if (isDefined(value)) result.push(encodeUnreserved(key));
	} else if (value === "" && (operator === "&" || operator === "?")) result.push(encodeUnreserved(key) + "=");
	else if (value === "") result.push("");
	return result;
}
function parseUrl(template) {
	return { expand: expand.bind(null, template) };
}
function expand(template, context) {
	var operators = [
		"+",
		"#",
		".",
		"/",
		";",
		"?",
		"&"
	];
	template = template.replace(/\{([^\{\}]+)\}|([^\{\}]+)/g, function(_, expression, literal) {
		if (expression) {
			let operator = "";
			const values = [];
			if (operators.indexOf(expression.charAt(0)) !== -1) {
				operator = expression.charAt(0);
				expression = expression.substr(1);
			}
			expression.split(/,/g).forEach(function(variable) {
				var tmp = /([^:\*]*)(?::(\d+)|(\*))?/.exec(variable);
				values.push(getValues(context, operator, tmp[1], tmp[2] || tmp[3]));
			});
			if (operator && operator !== "+") {
				var separator = ",";
				if (operator === "?") separator = "&";
				else if (operator !== "#") separator = operator;
				return (values.length !== 0 ? operator : "") + values.join(separator);
			} else return values.join(",");
		} else return encodeReserved(literal);
	});
	if (template === "/") return template;
	else return template.replace(/\/$/, "");
}
function parse(options) {
	let method = options.method.toUpperCase();
	let url = (options.url || "/").replace(/:([a-z]\w+)/g, "{$1}");
	let headers = Object.assign({}, options.headers);
	let body;
	let parameters = omit(options, [
		"method",
		"baseUrl",
		"url",
		"headers",
		"request",
		"mediaType"
	]);
	const urlVariableNames = extractUrlVariableNames(url);
	url = parseUrl(url).expand(parameters);
	if (!/^http/.test(url)) url = options.baseUrl + url;
	const remainingParameters = omit(parameters, Object.keys(options).filter((option) => urlVariableNames.includes(option)).concat("baseUrl"));
	if (!/application\/octet-stream/i.test(headers.accept)) {
		if (options.mediaType.format) headers.accept = headers.accept.split(/,/).map((format) => format.replace(/application\/vnd(\.\w+)(\.v3)?(\.\w+)?(\+json)?$/, `application/vnd$1$2.${options.mediaType.format}`)).join(",");
		if (url.endsWith("/graphql")) {
			if (options.mediaType.previews?.length) headers.accept = (headers.accept.match(/(?<![\w-])[\w-]+(?=-preview)/g) || []).concat(options.mediaType.previews).map((preview) => {
				return `application/vnd.github.${preview}-preview${options.mediaType.format ? `.${options.mediaType.format}` : "+json"}`;
			}).join(",");
		}
	}
	if (["GET", "HEAD"].includes(method)) url = addQueryParameters(url, remainingParameters);
	else if ("data" in remainingParameters) body = remainingParameters.data;
	else if (Object.keys(remainingParameters).length) body = remainingParameters;
	if (!headers["content-type"] && typeof body !== "undefined") headers["content-type"] = "application/json; charset=utf-8";
	if (["PATCH", "PUT"].includes(method) && typeof body === "undefined") body = "";
	return Object.assign({
		method,
		url,
		headers
	}, typeof body !== "undefined" ? { body } : null, options.request ? { request: options.request } : null);
}
function endpointWithDefaults(defaults, route, options) {
	return parse(merge(defaults, route, options));
}
function withDefaults$2(oldDefaults, newDefaults) {
	const DEFAULTS2 = merge(oldDefaults, newDefaults);
	const endpoint2 = endpointWithDefaults.bind(null, DEFAULTS2);
	return Object.assign(endpoint2, {
		DEFAULTS: DEFAULTS2,
		defaults: withDefaults$2.bind(null, DEFAULTS2),
		merge: merge.bind(null, DEFAULTS2),
		parse
	});
}
var endpoint = withDefaults$2(null, DEFAULTS);

//#endregion
//#region node_modules/fast-content-type-parse/index.js
var require_fast_content_type_parse = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const NullObject = function NullObject() {};
	NullObject.prototype = Object.create(null);
	/**
	* RegExp to match *( ";" parameter ) in RFC 7231 sec 3.1.1.1
	*
	* parameter     = token "=" ( token / quoted-string )
	* token         = 1*tchar
	* tchar         = "!" / "#" / "$" / "%" / "&" / "'" / "*"
	*               / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
	*               / DIGIT / ALPHA
	*               ; any VCHAR, except delimiters
	* quoted-string = DQUOTE *( qdtext / quoted-pair ) DQUOTE
	* qdtext        = HTAB / SP / %x21 / %x23-5B / %x5D-7E / obs-text
	* obs-text      = %x80-FF
	* quoted-pair   = "\" ( HTAB / SP / VCHAR / obs-text )
	*/
	const paramRE = /; *([!#$%&'*+.^\w`|~-]+)=("(?:[\v\u0020\u0021\u0023-\u005b\u005d-\u007e\u0080-\u00ff]|\\[\v\u0020-\u00ff])*"|[!#$%&'*+.^\w`|~-]+) */gu;
	/**
	* RegExp to match quoted-pair in RFC 7230 sec 3.2.6
	*
	* quoted-pair = "\" ( HTAB / SP / VCHAR / obs-text )
	* obs-text    = %x80-FF
	*/
	const quotedPairRE = /\\([\v\u0020-\u00ff])/gu;
	/**
	* RegExp to match type in RFC 7231 sec 3.1.1.1
	*
	* media-type = type "/" subtype
	* type       = token
	* subtype    = token
	*/
	const mediaTypeRE = /^[!#$%&'*+.^\w|~-]+\/[!#$%&'*+.^\w|~-]+$/u;
	const defaultContentType = {
		type: "",
		parameters: new NullObject()
	};
	Object.freeze(defaultContentType.parameters);
	Object.freeze(defaultContentType);
	/**
	* Parse media type to object.
	*
	* @param {string|object} header
	* @return {Object}
	* @public
	*/
	function parse(header) {
		if (typeof header !== "string") throw new TypeError("argument header is required and must be a string");
		let index = header.indexOf(";");
		const type = index !== -1 ? header.slice(0, index).trim() : header.trim();
		if (mediaTypeRE.test(type) === false) throw new TypeError("invalid media type");
		const result = {
			type: type.toLowerCase(),
			parameters: new NullObject()
		};
		if (index === -1) return result;
		let key;
		let match;
		let value;
		paramRE.lastIndex = index;
		while (match = paramRE.exec(header)) {
			if (match.index !== index) throw new TypeError("invalid parameter format");
			index += match[0].length;
			key = match[1].toLowerCase();
			value = match[2];
			if (value[0] === "\"") {
				value = value.slice(1, value.length - 1);
				quotedPairRE.test(value) && (value = value.replace(quotedPairRE, "$1"));
			}
			result.parameters[key] = value;
		}
		if (index !== header.length) throw new TypeError("invalid parameter format");
		return result;
	}
	function safeParse(header) {
		if (typeof header !== "string") return defaultContentType;
		let index = header.indexOf(";");
		const type = index !== -1 ? header.slice(0, index).trim() : header.trim();
		if (mediaTypeRE.test(type) === false) return defaultContentType;
		const result = {
			type: type.toLowerCase(),
			parameters: new NullObject()
		};
		if (index === -1) return result;
		let key;
		let match;
		let value;
		paramRE.lastIndex = index;
		while (match = paramRE.exec(header)) {
			if (match.index !== index) return defaultContentType;
			index += match[0].length;
			key = match[1].toLowerCase();
			value = match[2];
			if (value[0] === "\"") {
				value = value.slice(1, value.length - 1);
				quotedPairRE.test(value) && (value = value.replace(quotedPairRE, "$1"));
			}
			result.parameters[key] = value;
		}
		if (index !== header.length) return defaultContentType;
		return result;
	}
	module.exports.default = {
		parse,
		safeParse
	};
	module.exports.parse = parse;
	module.exports.safeParse = safeParse;
	module.exports.defaultContentType = defaultContentType;
}));

//#endregion
//#region node_modules/json-with-bigint/json-with-bigint.js
var import_fast_content_type_parse = require_fast_content_type_parse();
const noiseValue = /^-?\d+n+$/;
const originalStringify = JSON.stringify;
const originalParse = JSON.parse;
const JSONStringify = (value, replacer, space) => {
	if ("rawJSON" in JSON) return originalStringify(value, (key, value) => {
		if (typeof value === "bigint") return JSON.rawJSON(value.toString());
		if (typeof replacer === "function") return replacer(key, value);
		if (Array.isArray(replacer) && replacer.includes(key)) return value;
		return value;
	}, space);
	if (!value) return originalStringify(value, replacer, space);
	return originalStringify(value, (key, value) => {
		if (typeof value === "string" && Boolean(value.match(noiseValue))) return value.toString() + "n";
		if (typeof value === "bigint") return value.toString() + "n";
		if (typeof replacer === "function") return replacer(key, value);
		if (Array.isArray(replacer) && replacer.includes(key)) return value;
		return value;
	}, space).replace(/([\[:])?"(-?\d+)n"($|([\\n]|\s)*(\s|[\\n])*[,\}\]])/g, "$1$2$3").replace(/([\[:])?("-?\d+n+)n("$|"([\\n]|\s)*(\s|[\\n])*[,\}\]])/g, "$1$2$3");
};
const isContextSourceSupported = () => JSON.parse("1", (_, __, context) => !!context && context.source === "1");
const JSONParseV2 = (text, reviver) => {
	const intRegex = /^-?\d+$/;
	return JSON.parse(text, (key, value, context) => {
		const isBigNumber = typeof value === "number" && (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER);
		const isInt = intRegex.test(context.source);
		if (isBigNumber && isInt) return BigInt(context.source);
		if (typeof reviver !== "function") return value;
		return reviver(key, value, context);
	});
};
const JSONParse = (text, reviver) => {
	if (!text) return originalParse(text, reviver);
	if (isContextSourceSupported()) return JSONParseV2(text, reviver);
	const MAX_INT = Number.MAX_SAFE_INTEGER.toString();
	const MAX_DIGITS = MAX_INT.length;
	const stringsOrLargeNumbers = /"(?:\\.|[^"])*"|-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/g;
	const noiseValueWithQuotes = /^"-?\d+n+"$/;
	const customFormat = /^-?\d+n$/;
	return originalParse(text.replace(stringsOrLargeNumbers, (text, digits, fractional, exponential) => {
		const isString = text[0] === "\"";
		if (isString && Boolean(text.match(noiseValueWithQuotes))) return text.substring(0, text.length - 1) + "n\"";
		const isFractionalOrExponential = fractional || exponential;
		const isLessThanMaxSafeInt = digits && (digits.length < MAX_DIGITS || digits.length === MAX_DIGITS && digits <= MAX_INT);
		if (isString || isFractionalOrExponential || isLessThanMaxSafeInt) return text;
		return "\"" + text + "n\"";
	}), (key, value, context) => {
		if (typeof value === "string" && Boolean(value.match(customFormat))) return BigInt(value.substring(0, value.length - 1));
		if (typeof value === "string" && Boolean(value.match(noiseValue))) return value.substring(0, value.length - 1);
		if (typeof reviver !== "function") return value;
		return reviver(key, value, context);
	});
};

//#endregion
//#region node_modules/@octokit/request-error/dist-src/index.js
var RequestError = class extends Error {
	name;
	/**
	* http status code
	*/
	status;
	/**
	* Request options that lead to the error.
	*/
	request;
	/**
	* Response object if a response was received
	*/
	response;
	constructor(message, statusCode, options) {
		super(message, { cause: options.cause });
		this.name = "HttpError";
		this.status = Number.parseInt(statusCode);
		if (Number.isNaN(this.status)) this.status = 0;
		/* v8 ignore else -- @preserve -- Bug with vitest coverage where it sees an else branch that doesn't exist */
		if ("response" in options) this.response = options.response;
		const requestCopy = Object.assign({}, options.request);
		if (options.request.headers.authorization) requestCopy.headers = Object.assign({}, options.request.headers, { authorization: options.request.headers.authorization.replace(/(?<! ) .*$/, " [REDACTED]") });
		requestCopy.url = requestCopy.url.replace(/\bclient_secret=\w+/g, "client_secret=[REDACTED]").replace(/\baccess_token=\w+/g, "access_token=[REDACTED]");
		this.request = requestCopy;
	}
};

//#endregion
//#region node_modules/@octokit/request/dist-bundle/index.js
var VERSION$3 = "10.0.8";
var defaults_default = { headers: { "user-agent": `octokit-request.js/${VERSION$3} ${getUserAgent()}` } };
function isPlainObject(value) {
	if (typeof value !== "object" || value === null) return false;
	if (Object.prototype.toString.call(value) !== "[object Object]") return false;
	const proto = Object.getPrototypeOf(value);
	if (proto === null) return true;
	const Ctor = Object.prototype.hasOwnProperty.call(proto, "constructor") && proto.constructor;
	return typeof Ctor === "function" && Ctor instanceof Ctor && Function.prototype.call(Ctor) === Function.prototype.call(value);
}
var noop$1 = () => "";
async function fetchWrapper(requestOptions) {
	const fetch = requestOptions.request?.fetch || globalThis.fetch;
	if (!fetch) throw new Error("fetch is not set. Please pass a fetch implementation as new Octokit({ request: { fetch }}). Learn more at https://github.com/octokit/octokit.js/#fetch-missing");
	const log = requestOptions.request?.log || console;
	const parseSuccessResponseBody = requestOptions.request?.parseSuccessResponseBody !== false;
	const body = isPlainObject(requestOptions.body) || Array.isArray(requestOptions.body) ? JSONStringify(requestOptions.body) : requestOptions.body;
	const requestHeaders = Object.fromEntries(Object.entries(requestOptions.headers).map(([name, value]) => [name, String(value)]));
	let fetchResponse;
	try {
		fetchResponse = await fetch(requestOptions.url, {
			method: requestOptions.method,
			body,
			redirect: requestOptions.request?.redirect,
			headers: requestHeaders,
			signal: requestOptions.request?.signal,
			...requestOptions.body && { duplex: "half" }
		});
	} catch (error) {
		let message = "Unknown Error";
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				error.status = 500;
				throw error;
			}
			message = error.message;
			if (error.name === "TypeError" && "cause" in error) {
				if (error.cause instanceof Error) message = error.cause.message;
				else if (typeof error.cause === "string") message = error.cause;
			}
		}
		const requestError = new RequestError(message, 500, { request: requestOptions });
		requestError.cause = error;
		throw requestError;
	}
	const status = fetchResponse.status;
	const url = fetchResponse.url;
	const responseHeaders = {};
	for (const [key, value] of fetchResponse.headers) responseHeaders[key] = value;
	const octokitResponse = {
		url,
		status,
		headers: responseHeaders,
		data: ""
	};
	if ("deprecation" in responseHeaders) {
		const matches = responseHeaders.link && responseHeaders.link.match(/<([^<>]+)>; rel="deprecation"/);
		const deprecationLink = matches && matches.pop();
		log.warn(`[@octokit/request] "${requestOptions.method} ${requestOptions.url}" is deprecated. It is scheduled to be removed on ${responseHeaders.sunset}${deprecationLink ? `. See ${deprecationLink}` : ""}`);
	}
	if (status === 204 || status === 205) return octokitResponse;
	if (requestOptions.method === "HEAD") {
		if (status < 400) return octokitResponse;
		throw new RequestError(fetchResponse.statusText, status, {
			response: octokitResponse,
			request: requestOptions
		});
	}
	if (status === 304) {
		octokitResponse.data = await getResponseData(fetchResponse);
		throw new RequestError("Not modified", status, {
			response: octokitResponse,
			request: requestOptions
		});
	}
	if (status >= 400) {
		octokitResponse.data = await getResponseData(fetchResponse);
		throw new RequestError(toErrorMessage(octokitResponse.data), status, {
			response: octokitResponse,
			request: requestOptions
		});
	}
	octokitResponse.data = parseSuccessResponseBody ? await getResponseData(fetchResponse) : fetchResponse.body;
	return octokitResponse;
}
async function getResponseData(response) {
	const contentType = response.headers.get("content-type");
	if (!contentType) return response.text().catch(noop$1);
	const mimetype = (0, import_fast_content_type_parse.safeParse)(contentType);
	if (isJSONResponse(mimetype)) {
		let text = "";
		try {
			text = await response.text();
			return JSONParse(text);
		} catch (err) {
			return text;
		}
	} else if (mimetype.type.startsWith("text/") || mimetype.parameters.charset?.toLowerCase() === "utf-8") return response.text().catch(noop$1);
	else return response.arrayBuffer().catch(
		/* v8 ignore next -- @preserve */
		() => /* @__PURE__ */ new ArrayBuffer(0)
	);
}
function isJSONResponse(mimetype) {
	return mimetype.type === "application/json" || mimetype.type === "application/scim+json";
}
function toErrorMessage(data) {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) return "Unknown error";
	if ("message" in data) {
		const suffix = "documentation_url" in data ? ` - ${data.documentation_url}` : "";
		return Array.isArray(data.errors) ? `${data.message}: ${data.errors.map((v) => JSON.stringify(v)).join(", ")}${suffix}` : `${data.message}${suffix}`;
	}
	return `Unknown error: ${JSON.stringify(data)}`;
}
function withDefaults$1(oldEndpoint, newDefaults) {
	const endpoint2 = oldEndpoint.defaults(newDefaults);
	const newApi = function(route, parameters) {
		const endpointOptions = endpoint2.merge(route, parameters);
		if (!endpointOptions.request || !endpointOptions.request.hook) return fetchWrapper(endpoint2.parse(endpointOptions));
		const request2 = (route2, parameters2) => {
			return fetchWrapper(endpoint2.parse(endpoint2.merge(route2, parameters2)));
		};
		Object.assign(request2, {
			endpoint: endpoint2,
			defaults: withDefaults$1.bind(null, endpoint2)
		});
		return endpointOptions.request.hook(request2, endpointOptions);
	};
	return Object.assign(newApi, {
		endpoint: endpoint2,
		defaults: withDefaults$1.bind(null, endpoint2)
	});
}
var request = withDefaults$1(endpoint, defaults_default);
/* v8 ignore next -- @preserve */
/* v8 ignore else -- @preserve */

//#endregion
//#region node_modules/@octokit/graphql/dist-bundle/index.js
var VERSION$2 = "0.0.0-development";
function _buildMessageForResponseErrors(data) {
	return `Request failed due to following response errors:
` + data.errors.map((e) => ` - ${e.message}`).join("\n");
}
var GraphqlResponseError = class extends Error {
	constructor(request2, headers, response) {
		super(_buildMessageForResponseErrors(response));
		this.request = request2;
		this.headers = headers;
		this.response = response;
		this.errors = response.errors;
		this.data = response.data;
		if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
	}
	name = "GraphqlResponseError";
	errors;
	data;
};
var NON_VARIABLE_OPTIONS = [
	"method",
	"baseUrl",
	"url",
	"headers",
	"request",
	"query",
	"mediaType",
	"operationName"
];
var FORBIDDEN_VARIABLE_OPTIONS = [
	"query",
	"method",
	"url"
];
var GHES_V3_SUFFIX_REGEX = /\/api\/v3\/?$/;
function graphql(request2, query, options) {
	if (options) {
		if (typeof query === "string" && "query" in options) return Promise.reject(/* @__PURE__ */ new Error(`[@octokit/graphql] "query" cannot be used as variable name`));
		for (const key in options) {
			if (!FORBIDDEN_VARIABLE_OPTIONS.includes(key)) continue;
			return Promise.reject(/* @__PURE__ */ new Error(`[@octokit/graphql] "${key}" cannot be used as variable name`));
		}
	}
	const parsedOptions = typeof query === "string" ? Object.assign({ query }, options) : query;
	const requestOptions = Object.keys(parsedOptions).reduce((result, key) => {
		if (NON_VARIABLE_OPTIONS.includes(key)) {
			result[key] = parsedOptions[key];
			return result;
		}
		if (!result.variables) result.variables = {};
		result.variables[key] = parsedOptions[key];
		return result;
	}, {});
	const baseUrl = parsedOptions.baseUrl || request2.endpoint.DEFAULTS.baseUrl;
	if (GHES_V3_SUFFIX_REGEX.test(baseUrl)) requestOptions.url = baseUrl.replace(GHES_V3_SUFFIX_REGEX, "/api/graphql");
	return request2(requestOptions).then((response) => {
		if (response.data.errors) {
			const headers = {};
			for (const key of Object.keys(response.headers)) headers[key] = response.headers[key];
			throw new GraphqlResponseError(requestOptions, headers, response.data);
		}
		return response.data.data;
	});
}
function withDefaults(request2, newDefaults) {
	const newRequest = request2.defaults(newDefaults);
	const newApi = (query, options) => {
		return graphql(newRequest, query, options);
	};
	return Object.assign(newApi, {
		defaults: withDefaults.bind(null, newRequest),
		endpoint: newRequest.endpoint
	});
}
var graphql2 = withDefaults(request, {
	headers: { "user-agent": `octokit-graphql.js/${VERSION$2} ${getUserAgent()}` },
	method: "POST",
	url: "/graphql"
});
function withCustomRequest(customRequest) {
	return withDefaults(customRequest, {
		method: "POST",
		url: "/graphql"
	});
}

//#endregion
//#region node_modules/@octokit/auth-token/dist-bundle/index.js
var b64url = "(?:[a-zA-Z0-9_-]+)";
var sep = "\\.";
var jwtRE = new RegExp(`^${b64url}${sep}${b64url}${sep}${b64url}$`);
var isJWT = jwtRE.test.bind(jwtRE);
async function auth(token) {
	const isApp = isJWT(token);
	const isInstallation = token.startsWith("v1.") || token.startsWith("ghs_");
	const isUserToServer = token.startsWith("ghu_");
	return {
		type: "token",
		token,
		tokenType: isApp ? "app" : isInstallation ? "installation" : isUserToServer ? "user-to-server" : "oauth"
	};
}
function withAuthorizationPrefix(token) {
	if (token.split(/\./).length === 3) return `bearer ${token}`;
	return `token ${token}`;
}
async function hook(token, request, route, parameters) {
	const endpoint = request.endpoint.merge(route, parameters);
	endpoint.headers.authorization = withAuthorizationPrefix(token);
	return request(endpoint);
}
var createTokenAuth = function createTokenAuth2(token) {
	if (!token) throw new Error("[@octokit/auth-token] No token passed to createTokenAuth");
	if (typeof token !== "string") throw new Error("[@octokit/auth-token] Token passed to createTokenAuth is not a string");
	token = token.replace(/^(token|bearer) +/i, "");
	return Object.assign(auth.bind(null, token), { hook: hook.bind(null, token) });
};

//#endregion
//#region node_modules/@octokit/core/dist-src/version.js
const VERSION$1 = "7.0.6";

//#endregion
//#region node_modules/@octokit/core/dist-src/index.js
const noop = () => {};
const consoleWarn = console.warn.bind(console);
const consoleError = console.error.bind(console);
function createLogger(logger = {}) {
	if (typeof logger.debug !== "function") logger.debug = noop;
	if (typeof logger.info !== "function") logger.info = noop;
	if (typeof logger.warn !== "function") logger.warn = consoleWarn;
	if (typeof logger.error !== "function") logger.error = consoleError;
	return logger;
}
const userAgentTrail = `octokit-core.js/${VERSION$1} ${getUserAgent()}`;
var Octokit = class {
	static VERSION = VERSION$1;
	static defaults(defaults) {
		const OctokitWithDefaults = class extends this {
			constructor(...args) {
				const options = args[0] || {};
				if (typeof defaults === "function") {
					super(defaults(options));
					return;
				}
				super(Object.assign({}, defaults, options, options.userAgent && defaults.userAgent ? { userAgent: `${options.userAgent} ${defaults.userAgent}` } : null));
			}
		};
		return OctokitWithDefaults;
	}
	static plugins = [];
	/**
	* Attach a plugin (or many) to your Octokit instance.
	*
	* @example
	* const API = Octokit.plugin(plugin1, plugin2, plugin3, ...)
	*/
	static plugin(...newPlugins) {
		const currentPlugins = this.plugins;
		const NewOctokit = class extends this {
			static plugins = currentPlugins.concat(newPlugins.filter((plugin) => !currentPlugins.includes(plugin)));
		};
		return NewOctokit;
	}
	constructor(options = {}) {
		const hook = new before_after_hook_default.Collection();
		const requestDefaults = {
			baseUrl: request.endpoint.DEFAULTS.baseUrl,
			headers: {},
			request: Object.assign({}, options.request, { hook: hook.bind(null, "request") }),
			mediaType: {
				previews: [],
				format: ""
			}
		};
		requestDefaults.headers["user-agent"] = options.userAgent ? `${options.userAgent} ${userAgentTrail}` : userAgentTrail;
		if (options.baseUrl) requestDefaults.baseUrl = options.baseUrl;
		if (options.previews) requestDefaults.mediaType.previews = options.previews;
		if (options.timeZone) requestDefaults.headers["time-zone"] = options.timeZone;
		this.request = request.defaults(requestDefaults);
		this.graphql = withCustomRequest(this.request).defaults(requestDefaults);
		this.log = createLogger(options.log);
		this.hook = hook;
		if (!options.authStrategy) if (!options.auth) this.auth = async () => ({ type: "unauthenticated" });
		else {
			const auth = createTokenAuth(options.auth);
			hook.wrap("request", auth.hook);
			this.auth = auth;
		}
		else {
			const { authStrategy, ...otherOptions } = options;
			const auth = authStrategy(Object.assign({
				request: this.request,
				log: this.log,
				octokit: this,
				octokitOptions: otherOptions
			}, options.auth));
			hook.wrap("request", auth.hook);
			this.auth = auth;
		}
		const classConstructor = this.constructor;
		for (let i = 0; i < classConstructor.plugins.length; ++i) Object.assign(this, classConstructor.plugins[i](this, options));
	}
	request;
	graphql;
	log;
	hook;
	auth;
};

//#endregion
//#region node_modules/@octokit/plugin-paginate-rest/dist-bundle/index.js
var VERSION = "0.0.0-development";
function normalizePaginatedListResponse(response) {
	if (!response.data) return {
		...response,
		data: []
	};
	if (!(("total_count" in response.data || "total_commits" in response.data) && !("url" in response.data))) return response;
	const incompleteResults = response.data.incomplete_results;
	const repositorySelection = response.data.repository_selection;
	const totalCount = response.data.total_count;
	const totalCommits = response.data.total_commits;
	delete response.data.incomplete_results;
	delete response.data.repository_selection;
	delete response.data.total_count;
	delete response.data.total_commits;
	const namespaceKey = Object.keys(response.data)[0];
	response.data = response.data[namespaceKey];
	if (typeof incompleteResults !== "undefined") response.data.incomplete_results = incompleteResults;
	if (typeof repositorySelection !== "undefined") response.data.repository_selection = repositorySelection;
	response.data.total_count = totalCount;
	response.data.total_commits = totalCommits;
	return response;
}
function iterator(octokit, route, parameters) {
	const options = typeof route === "function" ? route.endpoint(parameters) : octokit.request.endpoint(route, parameters);
	const requestMethod = typeof route === "function" ? route : octokit.request;
	const method = options.method;
	const headers = options.headers;
	let url = options.url;
	return { [Symbol.asyncIterator]: () => ({ async next() {
		if (!url) return { done: true };
		try {
			const normalizedResponse = normalizePaginatedListResponse(await requestMethod({
				method,
				url,
				headers
			}));
			url = ((normalizedResponse.headers.link || "").match(/<([^<>]+)>;\s*rel="next"/) || [])[1];
			if (!url && "total_commits" in normalizedResponse.data) {
				const parsedUrl = new URL(normalizedResponse.url);
				const params = parsedUrl.searchParams;
				const page = parseInt(params.get("page") || "1", 10);
				if (page * parseInt(params.get("per_page") || "250", 10) < normalizedResponse.data.total_commits) {
					params.set("page", String(page + 1));
					url = parsedUrl.toString();
				}
			}
			return { value: normalizedResponse };
		} catch (error) {
			if (error.status !== 409) throw error;
			url = "";
			return { value: {
				status: 200,
				headers: {},
				data: []
			} };
		}
	} }) };
}
function paginate(octokit, route, parameters, mapFn) {
	if (typeof parameters === "function") {
		mapFn = parameters;
		parameters = void 0;
	}
	return gather(octokit, [], iterator(octokit, route, parameters)[Symbol.asyncIterator](), mapFn);
}
function gather(octokit, results, iterator2, mapFn) {
	return iterator2.next().then((result) => {
		if (result.done) return results;
		let earlyExit = false;
		function done() {
			earlyExit = true;
		}
		results = results.concat(mapFn ? mapFn(result.value, done) : result.value.data);
		if (earlyExit) return results;
		return gather(octokit, results, iterator2, mapFn);
	});
}
var composePaginateRest = Object.assign(paginate, { iterator });
function paginateRest(octokit) {
	return { paginate: Object.assign(paginate.bind(null, octokit), { iterator: iterator.bind(null, octokit) }) };
}
paginateRest.VERSION = VERSION;

//#endregion
//#region src/sdk/get-octokit.ts
const getOctokit = ({ token }) => {
	return new (Octokit.plugin(paginateRest))({ auth: token });
};
const getPrContext = () => ({
	issue_number: context.issue.number,
	owner: context.issue.owner,
	pull_number: context.issue.number,
	repo: context.issue.repo
});

//#endregion
//#region src/sdk/comment-pr.ts
/**
* Function that adds comment to the PR found in Github Action context
*
* Operates in `upsert` mode which creates sticky comment (it stays in the same place in the PR comment section)
*/
const commentPr = async ({ githubToken, markdown, commentId }) => {
	const octokit = getOctokit({ token: githubToken });
	const prContext = getPrContext();
	const commentFooter = `<!--dx-github-pr-generated-comment:${commentId}-->`;
	let previousPrComment;
	for await (const prComments of octokit.paginate.iterator("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", prContext)) {
		previousPrComment = prComments.data.find((comment) => Boolean(comment.body?.includes(commentFooter)));
		if (previousPrComment) break;
	}
	const body = typeof markdown === "string" ? `${markdown}\n${commentFooter}` : `${markdown(previousPrComment?.body?.replace(commentFooter, ""))}${commentFooter}`;
	if (!previousPrComment) {
		await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
			...prContext,
			body
		});
		return {
			action: "create",
			commentBody: body
		};
	}
	await octokit.request("POST /repos/{owner}/{repo}/issues/comments/{comment_id}", {
		...prContext,
		body,
		comment_id: previousPrComment.id
	});
	return {
		action: "upsert",
		commentBody: body
	};
};

//#endregion
//#region src/sdk/pr-beacon.ts
const prContext = getPrContext();
let prInfoCache;
/**
* Default content ID derived from the current workflow and job names.
* Used to scope beacon content to the job that produced it, enabling
* targeted upserts across multiple CI jobs.
*/
const getDefaultContentId = () => `${context.workflow}/${context.job}`;
const convertMarkdownToHtml = (message) => marked.parse(message, {
	async: false,
	breaks: true,
	gfm: true
});
/**
* PR beacon is sticky comment in PR, that has 2 main sections: tables and markdowns
*
* Tables are always in the top of the report, and there are 3 table types: fails, warning, messages
* Having at least 1 record in `fails` table causes the action to throw error after submit
*
* Markdowns are always in the bottom of the report, and these are basically markdown sections without any limitations
*
* Changes to PR beacon are accumulated from calls of `fail`, `warn`, `message` and `markdown` function
* and then submitted with `submit` function.
*
* `submit` function creates/updates sticky PR beacon and can be called from multiple jobs in CI
* each call will always update only relevant type of PR beacon content
*/
var PrBeacon = class PrBeacon {
	tables = {
		fails: [],
		messages: [],
		warnings: []
	};
	markdowns = [];
	githubToken;
	octokit;
	constructor({ githubToken } = {}) {
		const token = githubToken ?? process$1.env.GITHUB_TOKEN;
		if (token === void 0 || token === "") throw new Error("Github token is not provided. Please provide it as `githubToken` parameter or set it in `GITHUB_TOKEN` environment variable.");
		this.githubToken = token;
		this.octokit = getOctokit({ token: this.githubToken });
	}
	_fetchPrInfo = async () => this.octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", prContext);
	getPrInfo = async () => {
		if (!prInfoCache) prInfoCache = (await this._fetchPrInfo()).data;
		return prInfoCache;
	};
	/**
	* Helper function to get list of changed files in PR
	*/
	getChangedFiles = async () => this.octokit.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
		...prContext,
		per_page: 100
	});
	/**
	* Add fail message to the `Fails` beacon section
	*/
	fail(message, { markdownToHtml, ...meta } = {}) {
		this.tables.fails.push({
			id: getDefaultContentId(),
			message: markdownToHtml === true ? convertMarkdownToHtml(message) : message,
			...meta
		});
	}
	/**
	* Add warning message to the `Warnings` table in the PR beacon
	*/
	warn(message, { markdownToHtml, ...meta } = {}) {
		this.tables.warnings.push({
			id: getDefaultContentId(),
			message: markdownToHtml === true ? convertMarkdownToHtml(message) : message,
			...meta
		});
	}
	/**
	* Add message to the `Messages` table in the PR beacon
	*/
	message(message, { markdownToHtml, ...meta } = {}) {
		this.tables.messages.push({
			id: getDefaultContentId(),
			message: markdownToHtml === true ? convertMarkdownToHtml(message) : message,
			...meta
		});
	}
	/**
	* Append markdown to the free format section under all tables in the PR beacon
	*/
	markdown(id, message) {
		this.markdowns.push({
			id,
			message
		});
	}
	static _updateFooter = ({ oldBeacon }) => {
		let newBeacon = oldBeacon.replaceAll(/<p align="right"><sub>Generated .*?<\/sub><\/p>/gm, "");
		const humanReadableTime = (/* @__PURE__ */ new Date()).toLocaleString("cs-CZ", {
			timeZone: "Europe/Prague",
			timeZoneName: "shortOffset"
		});
		const headSha = (context.payload.pull_request?.head)?.sha;
		newBeacon += `<p align="right"><sub>Generated <code>${humanReadableTime}</code> for ${headSha}</sub></p>`;
		return newBeacon;
	};
	/**
	* Returns true if `prBeacon.fail()` was called before
	*/
	hasFails() {
		return this.tables.fails.length > 0;
	}
	/**
	* Submit content accumulated from `fail`, `warn`, `message` and `markdown` functions and update PR beacon.
	* Is not meant to be called directly, but rather through `runPrBeacon` function
	*/
	async _submit(options = {}) {
		const { contentIdsToUpdate = [getDefaultContentId()] } = options;
		const updateReport = (oldBeacon) => {
			let newBeacon = oldBeacon ?? emptyTablesTemplate;
			newBeacon = updateTables({
				contentIdsToUpdate,
				newTables: this.tables,
				oldBeacon: newBeacon
			});
			newBeacon = updateMarkdowns({
				contentIdsToUpdate,
				newMarkdowns: this.markdowns,
				oldBeacon: newBeacon
			});
			newBeacon = PrBeacon._updateFooter({ oldBeacon: newBeacon });
			return newBeacon;
		};
		const commentResult = await commentPr({
			commentId: "PR-BEACON",
			githubToken: this.githubToken,
			markdown: updateReport
		});
		if (this.hasFails()) setFailed(`Check failed with ${this.tables.fails.length} errors!`);
		return commentResult;
	}
};

//#endregion
//#region src/sdk/index.ts
/**
* Runs the provided callback and automatically submits the beacon at the end.
*
* @example
* await submitPrBeacon(async (prBeacon) => {
*   prBeacon.fail('Something went wrong');
*   prBeacon.warn('Something looks suspicious');
* });
*/
const submitPrBeacon = async (callback, options) => {
	const prBeacon = new PrBeacon(options);
	await callback(prBeacon);
	return prBeacon._submit(options);
};

//#endregion
//#region src/action/index.ts
const tableRowSchema = z.union([z.string(), z.object({
	icon: z.string().optional(),
	id: z.string().optional(),
	message: z.string()
})]);
/** A single row, or an array of rows, for fail / warn / message inputs. */
const tableRowInputSchema = z.union([tableRowSchema, z.array(tableRowSchema)]);
const markdownEntrySchema = z.object({
	id: z.string(),
	message: z.string()
});
/** A single markdown section, or an array of them. */
const markdownInputSchema = z.union([markdownEntrySchema, z.array(markdownEntrySchema)]);
/** Full JSON payload accepted by the `json` / `json-file` inputs. */
const jsonPayloadSchema = z.object({
	fails: z.array(tableRowSchema).optional(),
	markdowns: z.array(markdownEntrySchema).optional(),
	messages: z.array(tableRowSchema).optional(),
	options: z.object({ contentIdsToUpdate: z.array(z.string()).optional() }).optional(),
	warnings: z.array(tableRowSchema).optional()
});
/** Return `undefined` when an action input is empty/unset. */
const optionalInput = (name) => {
	const value = getInput(name);
	return value === "" ? void 0 : value;
};
/**
* Parse a raw action input as JSON.
* For `fail`, `warn`, and `message` inputs a plain (non-JSON) string is also
* accepted and treated as a bare message string.
*/
const parseJsonInput = (raw, allowPlainString) => {
	try {
		return JSON.parse(raw);
	} catch {
		if (allowPlainString) return raw;
		throw new Error(`Could not parse value as JSON: ${raw}`);
	}
};
/** Normalise a row input to an array. */
const toRowArray = (value) => Array.isArray(value) ? value : [value];
/** Normalise a markdown input to an array. */
const toMarkdownArray = (value) => Array.isArray(value) ? value : [value];
/** Unpack a table-row input into `(message, meta)` arguments. */
const unpackRow = (row) => {
	if (typeof row === "string") return [row, { markdownToHtml: true }];
	const { message, ...meta } = row;
	return [message, {
		...meta,
		markdownToHtml: true
	}];
};
const isEmptyRow = (row) => {
	if (typeof row === "string") return row.trim().length === 0;
	return row.message.trim().length === 0;
};
/** Apply rows coming from the structured JSON payload. */
const applyJsonPayload = (prBeacon, jsonPayload) => {
	for (const row of jsonPayload.fails ?? []) if (!isEmptyRow(row)) prBeacon.fail(...unpackRow(row));
	for (const row of jsonPayload.warnings ?? []) if (!isEmptyRow(row)) prBeacon.warn(...unpackRow(row));
	for (const row of jsonPayload.messages ?? []) if (!isEmptyRow(row)) prBeacon.message(...unpackRow(row));
	for (const { id, message } of jsonPayload.markdowns ?? []) if (message.trim().length > 0) prBeacon.markdown(id, message);
};
/** Apply rows coming from individual action inputs. */
const applyIndividualInputs = (prBeacon, inputs) => {
	const { failInput, warnInput, messageInput, markdownInput } = inputs;
	if (failInput !== void 0) {
		const parsed = tableRowInputSchema.parse(parseJsonInput(failInput, true));
		for (const row of toRowArray(parsed)) prBeacon.fail(...unpackRow(row));
	}
	if (warnInput !== void 0) {
		const parsed = tableRowInputSchema.parse(parseJsonInput(warnInput, true));
		for (const row of toRowArray(parsed)) prBeacon.warn(...unpackRow(row));
	}
	if (messageInput !== void 0) {
		const parsed = tableRowInputSchema.parse(parseJsonInput(messageInput, true));
		for (const row of toRowArray(parsed)) prBeacon.message(...unpackRow(row));
	}
	if (markdownInput !== void 0) {
		const parsed = markdownInputSchema.parse(parseJsonInput(markdownInput, false));
		for (const { id, message } of toMarkdownArray(parsed)) prBeacon.markdown(id, message);
	}
};
try {
	process$1.env.GITHUB_TOKEN = getInput("token", { required: true });
	const jsonInline = optionalInput("json");
	const jsonFile = optionalInput("json-file");
	if (jsonInline !== void 0 && jsonFile !== void 0) throw new Error("Inputs 'json' and 'json-file' are mutually exclusive – provide only one.");
	let jsonPayload;
	if (jsonInline !== void 0) jsonPayload = jsonPayloadSchema.parse(parseJsonInput(jsonInline, false));
	else if (jsonFile !== void 0) {
		const raw = readFileSync(jsonFile, "utf8");
		jsonPayload = jsonPayloadSchema.parse(parseJsonInput(raw, false));
	}
	const failInput = optionalInput("fail");
	const warnInput = optionalInput("warn");
	const messageInput = optionalInput("message");
	const markdownInput = optionalInput("markdown");
	const contentIdsToUpdateRaw = optionalInput("content-ids-to-update");
	const contentIdsToUpdate = contentIdsToUpdateRaw === void 0 || contentIdsToUpdateRaw === "" ? void 0 : contentIdsToUpdateRaw.split(",").map((entry) => entry.trim()).filter(Boolean);
	const resolvedContentIdsToUpdate = jsonPayload?.options?.contentIdsToUpdate ?? contentIdsToUpdate;
	const buildBeaconCallback = (prBeacon) => {
		if (jsonPayload !== void 0) applyJsonPayload(prBeacon, jsonPayload);
		applyIndividualInputs(prBeacon, {
			failInput,
			markdownInput,
			messageInput,
			warnInput
		});
	};
	await submitPrBeacon(buildBeaconCallback, { contentIdsToUpdate: resolvedContentIdsToUpdate });
} catch (error) {
	setFailed(error instanceof Error ? error.message : String(error));
}

//#endregion
export {  };
//# sourceMappingURL=index.mjs.map