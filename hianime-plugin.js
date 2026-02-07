// HiAnime Plugin for Mojuru iOS
// Base URL for the site (supports both .to and .bz)
const BASE_URL = 'https://hianime.to';

/**
 * Helper function to extract text between two strings
 */
function extractBetween(str, start, end) {
  const startIndex = str.indexOf(start);
  if (startIndex === -1) return null;
  const startPos = startIndex + start.length;
  const endIndex = str.indexOf(end, startPos);
  if (endIndex === -1) return null;
  return str.substring(startPos, endIndex);
}

/**
 * Helper function to extract all matches between patterns
 */
function extractAll(str, startPattern, endPattern) {
  const results = [];
  let searchFrom = 0;
  
  while (true) {
    const startIndex = str.indexOf(startPattern, searchFrom);
    if (startIndex === -1) break;
    
    const startPos = startIndex + startPattern.length;
    const endIndex = str.indexOf(endPattern, startPos);
    if (endIndex === -1) break;
    
    results.push(str.substring(startPos, endIndex));
    searchFrom = endIndex + endPattern.length;
  }
  
  return results;
}

/**
 * Clean HTML entities
 */
function decodeHTML(html) {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/**
 * Search for anime by query
 * @param {string} query - Search term
 * @returns {Promise<Array>} Array of search results
 */
async function search(query) {
  try {
    const searchUrl = `${BASE_URL}/search?keyword=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl);
    
    if (!response.ok) {
      console.error('Search failed:', response.status);
      return [];
    }
    
    const html = await response.text();
    const results = [];
    
    // Method 1: Look for film poster divs (most common structure)
    const posterPattern = /<div[^>]*class="[^"]*film-poster[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>[\s\S]*?<img[^>]*data-src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>[\s\S]*?<\/div>/g;
    let match;
    
    while ((match = posterPattern.exec(html)) !== null) {
      const href = match[1];
      const image = match[2];
      const title = decodeHTML(match[3]);
      const id = href.split('/').filter(Boolean).pop();
      
      if (id && title) {
        results.push({
          id: id,
          title: title,
          image: image || '',
          url: `${BASE_URL}${href}`
        });
      }
    }
    
    // Method 2: Fallback - simple link pattern
    if (results.length === 0) {
      const linkPattern = /<a[^>]*href="\/watch\/([^"?]+)[^"]*"[^>]*title="([^"]*)"[^>]*>/g;
      
      while ((match = linkPattern.exec(html)) !== null) {
        const id = match[1];
        const title = decodeHTML(match[2]);
        
        if (id && title) {
          results.push({
            id: id,
            title: title,
            image: '',
            url: `${BASE_URL}/watch/${id}`
          });
        }
      }
    }
    
    console.log('Search found', results.length, 'results for:', query);
    return results;
  } catch (error) {
    console.error('Search error:', error.message || error);
    return [];
  }
}

/**
 * Fetch episodes for an anime
 * @param {string} id - Anime ID
 * @returns {Promise<Array>} Array of episodes
 */
async function fetchEpisodes(id) {
  try {
    const animeUrl = `${BASE_URL}/watch/${id}`;
    const response = await fetch(animeUrl);
    const html = await response.text();
    
    const episodes = [];
    
    // Try to extract data-id for AJAX call
    const dataIdMatch = html.match(/data-id="(\d+)"/);
    
    if (dataIdMatch) {
      const dataId = dataIdMatch[1];
      
      // Try AJAX endpoint for episode list
      try {
        const ajaxUrl = `${BASE_URL}/ajax/v2/episode/list/${dataId}`;
        const ajaxResponse = await fetch(ajaxUrl);
        const ajaxData = await ajaxResponse.json();
        
        if (ajaxData.html) {
          // Parse episode items from HTML response
          const epPattern = /<a[^>]*class="[^"]*ep-item[^"]*"[^>]*data-number="(\d+)"[^>]*data-id="([^"]*)"[^>]*>/g;
          let match;
          
          while ((match = epPattern.exec(ajaxData.html)) !== null) {
            episodes.push({
              id: match[2],
              number: parseInt(match[1], 10)
            });
          }
        }
      } catch (ajaxError) {
        console.error('AJAX fetch failed:', ajaxError);
      }
    }
    
    // Fallback: try to extract episodes from main page
    if (episodes.length === 0) {
      const epPattern = /<a[^>]*class="[^"]*ep-item[^"]*"[^>]*(?:data-number="(\d+)"[^>]*)?(?:data-id="([^"]*)")?[^>]*href="([^"]*)"[^>]*>/g;
      let match;
      
      while ((match = epPattern.exec(html)) !== null) {
        const epNum = match[1];
        const epId = match[2] || match[3].split('/').pop();
        
        if (epId && epNum) {
          episodes.push({
            id: epId,
            number: parseInt(epNum, 10)
          });
        }
      }
    }
    
    // Another fallback: look for simple episode links
    if (episodes.length === 0) {
      const linkPattern = /href="\/watch\/[^"]*\?ep=(\d+)"/g;
      let match;
      let epNum = 1;
      
      while ((match = linkPattern.exec(html)) !== null) {
        episodes.push({
          id: `${id}?ep=${match[1]}`,
          number: parseInt(match[1], 10)
        });
      }
    }
    
    // Sort episodes by number
    return episodes.sort((a, b) => a.number - b.number);
  } catch (error) {
    console.error('Fetch episodes error:', error);
    return [];
  }
}

/**
 * Fetch streaming sources for an episode
 * @param {string} id - Episode ID
 * @returns {Promise<Array>} Array of streaming sources
 */
async function fetchSources(id) {
  try {
    // First, get the episode page
    const episodeUrl = id.startsWith('http') ? id : `${BASE_URL}/watch/${id}`;
    const response = await fetch(episodeUrl);
    const html = await response.text();
    
    const sources = [];
    const subtitles = [];
    
    // Extract server data-id values
    const serverPattern = /data-id="(\d+)"[^>]*class="[^"]*server-item[^"]*"/g;
    const serverIds = [];
    let match;
    
    while ((match = serverPattern.exec(html)) !== null) {
      serverIds.push(match[1]);
    }
    
    // Try each server to get sources
    for (const serverId of serverIds) {
      try {
        const sourceUrl = `${BASE_URL}/ajax/v2/episode/sources?id=${serverId}`;
        const sourceResponse = await fetch(sourceUrl);
        const sourceData = await sourceResponse.json();
        
        if (sourceData.link) {
          // Extract the actual video URL from the embed
          const videoUrl = await extractVideoUrl(sourceData.link);
          
          if (videoUrl) {
            sources.push({
              label: sourceData.type || 'Server ' + serverId,
              type: videoUrl.includes('.m3u8') ? 'hls' : 'mp4',
              qualities: [{
                quality: 'default',
                url: videoUrl,
                headers: {
                  'Referer': BASE_URL,
                  'Origin': BASE_URL,
                  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
                }
              }]
            });
          }
        }
      } catch (e) {
        console.error('Error extracting source:', e);
      }
    }
    
    // Look for subtitle tracks in the HTML
    const subPattern = /<track[^>]*kind="(?:subtitles|captions)"[^>]*src="([^"]*)"[^>]*(?:label="([^"]*)")?[^>]*(?:srclang="([^"]*)")?/g;
    
    while ((match = subPattern.exec(html)) !== null) {
      const subUrl = match[1];
      const label = match[2] || 'English';
      const lang = match[3] || 'en';
      
      if (subUrl) {
        subtitles.push({
          url: subUrl.startsWith('http') ? subUrl : `${BASE_URL}${subUrl}`,
          label: label,
          language: lang,
          format: 'vtt'
        });
      }
    }
    
    return sources.map(source => ({
      ...source,
      subtitles: subtitles
    }));
  } catch (error) {
    console.error('Fetch sources error:', error);
    return [];
  }
}

/**
 * Helper function to extract actual video URL from embed pages
 * @param {string} embedUrl - Embed page URL
 * @returns {Promise<string|null>} Video URL
 */
async function extractVideoUrl(embedUrl) {
  try {
    const response = await fetch(embedUrl, {
      headers: {
        'Referer': BASE_URL,
        'Origin': BASE_URL
      }
    });
    const html = await response.text();
    
    // Look for m3u8 URLs
    const m3u8Match = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
    if (m3u8Match) {
      return m3u8Match[1];
    }
    
    // Look for sources array in JavaScript
    const sourcesMatch = html.match(/sources:\s*\[\s*\{\s*(?:file|src|url):\s*["']([^"']+)["']/);
    if (sourcesMatch) {
      return sourcesMatch[1];
    }
    
    // Look for file: "url" pattern
    const fileMatch = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/);
    if (fileMatch) {
      return fileMatch[1];
    }
    
    // Look for source with mp4
    const mp4Match = html.match(/(?:file|src|url):\s*["']([^"']+\.mp4[^"']*)["']/);
    if (mp4Match) {
      return mp4Match[1];
    }
    
    return null;
  } catch (error) {
    console.error('Extract video URL error:', error);
    return null;
  }
}

// Return functions as required by Mojuru
return {
  search,
  fetchEpisodes,
  fetchSources
};
