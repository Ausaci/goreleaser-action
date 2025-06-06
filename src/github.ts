import * as goreleaser from './goreleaser';
import * as semver from 'semver';
import * as core from '@actions/core';
import * as httpm from '@actions/http-client';

export interface GitHubRelease {
  tag_name: string;
}

export const getRelease = async (distribution: string, version: string): Promise<GitHubRelease> => {
  if (version === 'latest') {
    core.warning("You are using 'latest' as default version. Will lock to '~> v2'.");
    return getReleaseTag(distribution, '~> v2');
  }
  return getReleaseTag(distribution, version);
};

export const getReleaseTag = async (distribution: string, version: string): Promise<GitHubRelease> => {
  if (version === 'nightly') {
    return {tag_name: version};
  }
  const tag: string = (await resolveVersion(distribution, version)) || version;
  const suffix: string = goreleaser.distribSuffix(distribution);
  const url = `https://goreleaser.com/static/releases${suffix}.json`;
  const http: httpm.HttpClient = new httpm.HttpClient('goreleaser-action');
  const resp: httpm.HttpClientResponse = await http.get(url);
  const body = await resp.readBody();
  const statusCode = resp.message.statusCode || 500;
  if (statusCode >= 400) {
    throw new Error(`Failed to get GoReleaser release ${version} from ${url} with status code ${statusCode}: ${body}`);
  }
  const releases = <Array<GitHubRelease>>JSON.parse(body);
  const res = releases.filter(r => r.tag_name === tag).shift();
  if (res) {
    return res;
  }
  throw new Error(`Cannot find GoReleaser release ${version} in ${url}`);
};

const resolveVersion = async (distribution: string, version: string): Promise<string | null> => {
  const allTags: Array<string> | null = await getAllTags(distribution);
  if (!allTags) {
    throw new Error(`Cannot download ${distribution} tags`);
  }
  core.debug(`Found ${allTags.length} tags in total`);

  const cleanTags: Array<string> = allTags.map(tag => cleanTag(tag));
  const cleanVersion: string = cleanTag(version);
  if (!semver.valid(cleanVersion) && !semver.validRange(cleanVersion)) {
    // if the given version is invalid, return whatever we got.
    return version;
  }
  const v = semver.maxSatisfying(cleanTags, cleanVersion);
  if (semver.lt(v, '2.7.0')) {
    // if its a version older than 2.7.0, append the suffix.
    return v + goreleaser.distribSuffix(distribution);
  }
  return v;
};

interface GitHubTag {
  tag_name: string;
}

const getAllTags = async (distribution: string): Promise<Array<string>> => {
  const http: httpm.HttpClient = new httpm.HttpClient('goreleaser-action');
  const suffix: string = goreleaser.distribSuffix(distribution);
  const url = `https://goreleaser.com/static/releases${suffix}.json`;
  core.debug(`Downloading ${url}`);
  const getTags = http.getJson<Array<GitHubTag>>(url);
  return getTags.then(response => {
    if (response.result == null) {
      return [];
    }
    return response.result.map(obj => obj.tag_name);
  });
};

const cleanTag = (tag: string): string => {
  return tag.replace(/-pro$/, '');
};
