chrome.runtime.onInstalled.addListener(() => {
  // Set up the context menu only once when the extension is installed
  console.log("Creating context menu item for disconnecting Twitch account");
  chrome.contextMenus.create({
    id: "disconnectTwitch",
    title: "Disconnect Twitch Account",
    contexts: ["action"] // Updated to 'action'
  });  
  // Fetch the list immediately upon installation
  fetchList();

  // Set up an interval to fetch the list every hour
  setInterval(fetchList, 3600000); // 3600000 milliseconds = 1 hour
});

function fetchList() {
  console.log("fetchList called"); // Test log
  chrome.storage.local.get(["twitchAccessToken", "userId"], (result) => {
    if (result.twitchAccessToken && result.userId) {
      fetchFollowList(result.twitchAccessToken, result.userId);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startOAuth") {
    const twitchClientId = "z05n4woixewpyagrqrui76x28avd2g";
    const redirectUri =
      "https://hbahknjghhdefhjoeebaiaiogcbhmbll.chromiumapp.org/";

    chrome.identity.launchWebAuthFlow(
      {
        url: `https://id.twitch.tv/oauth2/authorize?response_type=token&client_id=${twitchClientId}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&scope=user:read:follows`,
        interactive: true,
      },
      (redirectUrl) => {
        // Extract the access token from the redirect URL
        if (redirectUrl) {
          const url = new URL(redirectUrl);
          const hash = url.hash.substring(1);
          const params = new URLSearchParams(hash);
          const accessToken = params.get("access_token");

          // Store the access token
          if (accessToken) {
            chrome.storage.local.set({ twitchAccessToken: accessToken }, () => {
              console.log("Twitch Access Token saved");
              chrome.runtime.sendMessage({ action: "oauthComplete" });
              // Fetch user profile and follow list
              fetchUserProfile(accessToken);
            });
          }
        }
      }
    );
  }
});

function fetchUserProfile(accessToken) {
  fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": "z05n4woixewpyagrqrui76x28avd2g",
    },
  })
    .then((response) => response.json())
    .then((data) => {
      const userId = data.data[0].id;
      // Store userId in local storage
      chrome.storage.local.set({ userId: userId }, () => {
        console.log("User ID saved");
        fetchFollowList(accessToken, userId);
      });
    })
    .catch((error) => console.error("Error fetching user profile:", error));
}

function fetchFollowList(accessToken, userId, cursor = "", followedList = []) {
  let url = `https://api.twitch.tv/helix/channels/followed?user_id=${userId}&first=100`;
  if (cursor) {
    url += `&after=${cursor}`;
  }

  console.log("Fetching follow list..."); // Log the start of the fetch process

  fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": "z05n4woixewpyagrqrui76x28avd2g",
    },
  })
  .then((response) => {
    console.log("API Response:", response); // Log the raw response
    return response.json();
  })
  .then((data) => {
    console.log("Data Received:", data); // Log the data received
    followedList = followedList.concat(data.data);

    if (data.pagination && data.pagination.cursor) {
      fetchFollowList(
        accessToken,
        userId,
        data.pagination.cursor,
        followedList
      );
    } else {
      chrome.storage.local.set({ followedList: followedList }, () => {
        console.log("Followed Channels saved in local storage");
        console.log("Complete Followed Channels:", followedList);

        // Call fetchStreamData here after followed channels are saved
        fetchStreamData(accessToken, followedList);
      });
    }
  })
  .catch((error) => {
    console.error("Error fetching follow list:", error);
  });
}

function fetchStreamData(accessToken, followedList) {
  console.log("Fetching stream data...");

  const streamFetchPromises = followedList.map(channel => {
    const url = `https://api.twitch.tv/helix/streams?user_login=${channel.broadcaster_login}`; // Corrected property

    return fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": "z05n4woixewpyagrqrui76x28avd2g",
      },
    })
    .then(response => response.json())
    .then(data => {
      if (data.data && data.data.length > 0) {
        console.log(`Live Channel: ${channel.broadcaster_name}, Viewers: ${data.data[0].viewer_count}`);
        return { channelName: channel.broadcaster_name, viewers: data.data[0].viewer_count, live: true };
      }
      return null;
    })
    .catch(error => {
      console.error("Error fetching stream data for channel:", channel.broadcaster_login, error);
      return null;
    });
  });

  Promise.all(streamFetchPromises).then(streamData => {
    const liveStreams = streamData.filter(data => data !== null);
    chrome.storage.local.set({ 'liveStreams': liveStreams }, () => {
      console.log("Live stream data updated in local storage", liveStreams);
    });
  });
}

// Fetch and update the live stream data periodically
setInterval(() => {
  chrome.storage.local.get(['twitchAccessToken', 'followedList'], (result) => {
    if (result.twitchAccessToken && result.followedList) {
      console.log("Updating live stream data...");
      fetchStreamData(result.twitchAccessToken, result.followedList);
    }
  });
}, 20000); // 10 seconds interval

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "disconnectTwitch") {
    console.log("Context menu item clicked - Disconnecting Twitch account");

    // Clear the entire local storage for this extension
    chrome.storage.local.clear(() => {
      console.log("Local storage cleared - Twitch account disconnected");
    });
  }
});