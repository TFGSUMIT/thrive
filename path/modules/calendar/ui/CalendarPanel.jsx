import React from 'react';
import { Calendar } from 'react-calendar';

const CalendarPanel = ({ calendar }) => {
  return (
    <div>
      <h2>{calendar.name}</h2>
      <Calendar
        selectRange={true}
        onChange={(date) => console.log(date)}
      />
    </div>
  );
};

export default CalendarPanel;