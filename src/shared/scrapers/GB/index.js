import assert from 'assert';

import * as fetch from '../../lib/fetch/index.js';
import datetime from '../../lib/datetime/index.js';
import maintainers from '../../lib/maintainers.js';

import { gssCodeMap } from './_shared.js';

/**
 * dates don't have a delimiter, we add it here
 */
const parseDate = date => `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;

const scraper = {
  country: 'iso1:GB',
  url: 'https://publicdashacc.blob.core.windows.net/publicdata?restype=container&comp=list',
  aggregate: 'county',
  type: 'json',
  sources: [
    {
      name: 'GOV.UK',
      url: 'https://coronavirus.data.gov.uk'
    }
  ],
  maintainers: [maintainers.qgolsteyn],
  async scraper() {
    // The UK coronavirus website provides an XML description file that outlines the available
    // timeseries files. We get this file to get the latest source we can use.
    const $ = await fetch.page(this.url, false);

    const $blobs = $('Blob');

    let url;
    let date;

    // Go through each blob, find the ones that start with `data_` and look for the latest one
    $blobs.each((index, blob) => {
      const $blob = $(blob);

      const match = $blob
        .find('name')
        .text()
        .match(/data_(?<date>\d+)\.json/);
      if (match !== null && (!date || datetime.dateIsBeforeOrEqualTo(date, parseDate(match[1])))) {
        [url] = match;
        date = parseDate(match[1]);
      }
    });

    // Grab the json timeseries at the URL we found earlier
    const casesData = await fetch.json(`https://c19pub.azureedge.net/${url}`, false);

    // Countries contains data for the four GB countries (Scotland, England, etc.)
    // and utlas contains data for the counties of England
    const regionsData = { ...casesData.overview, ...casesData.countries, ...casesData.utlas };

    const data = [];

    // Regions use GSS codes, which the following object allow us to map to ISO codes
    const gssMap = await gssCodeMap();

    for (const key of Object.keys(gssMap)) {
      const location = regionsData[key];

      if (location) {
        // Grab the last data available
        const latestCases = location.dailyTotalConfirmedCases
          ? location.dailyTotalConfirmedCases[location.dailyTotalConfirmedCases.length - 1]
          : undefined;
        const latestDeaths = location.dailyTotalDeaths
          ? location.dailyTotalDeaths[location.dailyTotalDeaths.length - 1]
          : undefined;

        if (latestCases || latestDeaths) {
          data.push({
            // Place in location for now, we will map it later to `state` or `county`
            location: gssMap[key],
            cases: latestCases ? latestCases.value : undefined,
            deaths: latestDeaths ? latestDeaths.value : undefined
          });
        }
      }
    }

    assert(data.length === 155, 'Unexpected number of locations found, make sure the datasource has not changed');

    return data.map(item => {
      // If the ISO code belongs to GB, we assign it to the country as whole
      if (item.location === 'GB-UKM') {
        return {
          cases: item.cases,
          deaths: item.deaths
        };
      }
      if (
        item.location === 'GB-ENG' ||
        item.location === 'GB-SCT' ||
        item.location === 'GB-WLS' ||
        item.location === 'GB-NIR'
      ) {
        // If the ISO code belongs to a GB country, put it in the state field
        return {
          state: `iso2:${item.location}`,
          cases: item.cases,
          deaths: item.deaths
        };
      }
      // If the ISO code belongs to a England county, put it in the county field
      return {
        state: `iso2:GB-ENG`,
        county: `iso2:${item.location}`,
        cases: item.cases,
        deaths: item.deaths
      };
    });
  }
};

export default scraper;
