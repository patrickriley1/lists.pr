import { useEffect, useState } from 'react'
import './App.css'


function App() {
  const clientID = "52ef8393bb03454a8d33998beacb0927";
  const redirectURI = "https://lists-pr.vercel.app";
  const authEndpoint = "https://accounts.spotify.com/authorize";
  const responseType = "code";

  const [code, setCode] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    setCode(new URLSearchParams(window.location.search).get("code"));
  }, [])


  return (
    <div>
      <div className='header'>
        <h1>lists.pr</h1>
        <div className='verticalLineSmall'></div>
      </div>
      <div className='body'>
        <a href={`${authEndpoint}?client_id=${clientID}&redirect_uri=${redirectURI}&response_type=${responseType}`}>Login to Spotify</a>
        <p>{code}</p>
      </div>
    </div>
  )
}

export default App