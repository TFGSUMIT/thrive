import React, { useState, useEffect } from 'react';
import CalendarPanel from './CalendarPanel';
import SideLists from './SideLists';
import TrashRecyclingCalendar from './TrashRecyclingCalendar';

const CalendarPage = () => {
  const [calendars, setCalendars] = useState([]);
  const [selectedCalendar, setSelectedCalendar] = useState(null);

  useEffect(() => {
    // Load calendars from API
    fetch('/api/calendars')
      .then(response => response.json())
      .then(data => setCalendars(data))
      .catch(error => console.error(error));
  }, []);

  const handleCalendarSelect = (calendar) => {
    setSelectedCalendar(calendar);
  };

  return (
    <div>
      <SideLists calendars={calendars} onSelect={handleCalendarSelect} />
      {selectedCalendar && (
        <div>
          <CalendarPanel calendar={selectedCalendar} />
        </div>
      )}
      <TrashRecyclingCalendar />
    </div>
  );
};

export default CalendarPage;