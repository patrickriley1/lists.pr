import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import "./settings.css";

const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;

function SettingsPage({ canUseApp, authUser, updateCurrentUserProfile }) {
  const [username, setUsername] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function handleProfileImageUpload(file) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }

    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      setError("Image must be 2MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        setError("Could not read image file.");
        return;
      }
      setProfileImageUrl(result);
      setError("");
      setSuccess("");
    };
    reader.onerror = () => {
      setError("Could not read image file.");
    };
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    setUsername(authUser?.username || "");
    setProfileImageUrl(authUser?.profile_image_url || "");
  }, [authUser]);

  if (!canUseApp) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="settingsPage">
      <h2 className="pageTitle">Profile Settings</h2>
      <form
        className="settingsCard"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError("");
          setSuccess("");

          try {
            await updateCurrentUserProfile({
              username: username.trim(),
              profileImageUrl: profileImageUrl.trim(),
            });
            setSuccess("Profile updated.");
          } catch (err) {
            setError(err.message || "Could not update profile settings.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="settingsLabel" htmlFor="username-input">
          Username
        </label>
        <input
          id="username-input"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          required
          minLength={3}
        />

        <label className="settingsLabel" htmlFor="profile-image-url-input">
          Profile Image URL
        </label>
        <input
          id="profile-image-url-input"
          type="text"
          value={profileImageUrl}
          onChange={(event) => setProfileImageUrl(event.target.value)}
          placeholder="https://example.com/avatar.jpg"
        />
        <label className="settingsLabel" htmlFor="profile-image-upload-input">
          Or Upload Image
        </label>
        <input
          id="profile-image-upload-input"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            handleProfileImageUpload(file);
          }}
        />
        <p className="settingsHint">Max file size: 2MB</p>

        <div className="settingsAvatarPreviewWrap">
          {profileImageUrl ? (
            <img src={profileImageUrl} alt="Profile preview" className="settingsAvatarPreview" />
          ) : (
            <div className="settingsAvatarPreview placeholder">{username?.[0]?.toUpperCase() || "U"}</div>
          )}
        </div>

        {error ? <p className="authError">{error}</p> : null}
        {success ? <p className="settingsSuccess">{success}</p> : null}

        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}

export default SettingsPage;
