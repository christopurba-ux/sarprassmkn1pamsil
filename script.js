function showTime() {
	const currentTime = document.getElementById('currentTime');
	if (currentTime) currentTime.textContent = new Date().toUTCString();
}

showTime();
setInterval(showTime, 1000);