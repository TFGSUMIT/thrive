import React, { useState, useEffect } from 'react';
import { Calendar } from 'react-calendar';

const TrashRecyclingCalendar = () => {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    // Load events from OKC API
    fetch('https://services.arcgis.com/...')
      .then(response => response.json())
      .then(data => setEvents(data))
      .catch(error => console.error(error));
  }, []);

  return (
    <div>
      <h2>Trash & Recycling</h2>
      <Calendar
        selectRange={true}
        onChange={(date) => console.log(date)}
        events={events}
      />
    </div>
  );
};

export default TrashRecyclingCalendar;